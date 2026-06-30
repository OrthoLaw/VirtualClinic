import type { CapturedEvidence, FigmaFrameRef } from "./types";

const FIGMA_API = "https://api.figma.com/v1";
// Token-cost knobs (env-overridable). Images dominate cost: tokens ≈ w*h/750 per image.
// scale=1 ~4x cheaper than scale=2; fewer frames = linearly cheaper.
const MAX_FRAMES = Number(process.env.FIGMA_MAX_FRAMES) || 4;
const RENDER_SCALE = Number(process.env.FIGMA_RENDER_SCALE) || 1;

// Pull the file key out of any Figma URL form:
//   figma.com/file/<key>/...  | /design/<key>/...  | /proto/<key>/...
export function parseFigmaKey(url: string): string | null {
  const m = url.match(/figma\.com\/(?:file|design|proto)\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

// Pull the starting node id from a Figma URL (?node-id=2052-24267) and convert
// it to the API form ("2052:24267"). This is the frame the prototype opens on.
export function parseFigmaNodeId(url: string): string | null {
  const m = url.match(/[?&]node-id=([0-9]+-[0-9]+)/);
  return m ? m[1].replace("-", ":") : null;
}

interface FigmaNode {
  id: string;
  name: string;
  type: string;
  children?: FigmaNode[];
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  // Prototype wiring — where a click on this node navigates.
  transitionNodeID?: string;
  interactions?: { actions?: { destinationId?: string }[] }[];
  reactions?: { action?: { destinationId?: string } }[];
}

function headers() {
  const token = process.env.FIGMA_TOKEN;
  if (!token) throw new Error("FIGMA_TOKEN not set — cannot read Figma files.");
  return { "X-Figma-Token": token };
}

// Walk the (shallow) document tree, collecting the top-level FRAME/COMPONENT nodes
// across all pages. These are the screens a reviewer would step through.
// Width/height come from absoluteBoundingBox (used later to place comment pins).
interface CollectedFrame {
  id: string;
  name: string;
  width: number;
  height: number;
}
function collectFrames(doc: FigmaNode): CollectedFrame[] {
  const frames: CollectedFrame[] = [];
  const pages = doc.children ?? [];
  for (const page of pages) {
    for (const child of page.children ?? []) {
      if (["FRAME", "COMPONENT", "INSTANCE", "GROUP"].includes(child.type)) {
        const box = child.absoluteBoundingBox;
        frames.push({
          id: child.id,
          name: `${page.name} › ${child.name}`,
          width: box?.width ?? 0,
          height: box?.height ?? 0,
        });
      }
    }
  }
  return frames;
}

// Build a shallow text outline of a frame's layer names so the agent has
// structural context beyond the rendered image.
function outline(node: FigmaNode, depth = 0, lines: string[] = []): string[] {
  if (depth > 3 || lines.length > 120) return lines;
  lines.push(`${"  ".repeat(depth)}- [${node.type}] ${node.name}`);
  for (const c of node.children ?? []) outline(c, depth + 1, lines);
  return lines;
}

// Collect every prototype destination wired anywhere inside a node subtree,
// in document order (a click on a child button navigates to destinationId).
function scanDestinations(node: FigmaNode, acc: string[] = []): string[] {
  if (node.transitionNodeID) acc.push(node.transitionNodeID);
  for (const it of node.interactions ?? [])
    for (const a of it.actions ?? []) if (a.destinationId) acc.push(a.destinationId);
  for (const r of node.reactions ?? [])
    if (r.action?.destinationId) acc.push(r.action.destinationId);
  for (const c of node.children ?? []) scanDestinations(c, acc);
  return acc;
}

interface FlowFrame {
  id: string;
  name: string;
  width: number;
  height: number;
  node: FigmaNode;
}

// Walk the prototype flow starting at startId, following navigation links
// breadth-first, collecting up to MAX_FRAMES frames in the order a user hits them.
async function collectFlowFrames(
  key: string,
  startId: string,
): Promise<FlowFrame[]> {
  const visited = new Set<string>();
  const queue = [startId];
  const out: FlowFrame[] = [];
  let startW = 0; // width of the start screen — used to reject tiny component variants
  let guard = 0;
  // Traverse generously (component-heavy prototypes wire buttons to hover-state
  // variants), but only KEEP screen-sized frames so we don't capture buttons.
  while (queue.length && out.length < MAX_FRAMES && guard < MAX_FRAMES * 12) {
    guard++;
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const res = await fetch(
      `${FIGMA_API}/files/${key}/nodes?ids=${encodeURIComponent(id)}`,
      { headers: headers() },
    );
    if (!res.ok) continue;
    const j = await res.json();
    const node: FigmaNode | undefined = j.nodes?.[id]?.document;
    if (!node) continue;
    const box = node.absoluteBoundingBox;
    const frameish = ["FRAME", "COMPONENT", "INSTANCE", "GROUP"].includes(
      node.type,
    );
    if (box && frameish) {
      if (startW === 0) startW = box.width; // first frame = the start screen
      const isScreen =
        box.width >= Math.max(600, startW * 0.5) && box.height >= 400;
      // Always keep the start frame; otherwise require screen size.
      if (out.length === 0 || isScreen) {
        out.push({ id, name: node.name, width: box.width, height: box.height, node });
      }
    }
    for (const dest of scanDestinations(node))
      if (!visited.has(dest)) queue.push(dest);
  }
  return out;
}

// Give every captured frame a label that's unique (model maps findings to it by label).
function uniqueLabels<T extends { name: string }>(
  items: T[],
): (T & { label: string })[] {
  const seen = new Map<string, number>();
  return items.map((it) => {
    const n = (seen.get(it.name) ?? 0) + 1;
    seen.set(it.name, n);
    return { ...it, label: n > 1 ? `${it.name} #${n}` : it.name };
  });
}

// A chosen frame to capture: id + name + geometry, optionally with its subtree
// (present in flow mode, used for the structure outline).
interface ChosenFrame {
  id: string;
  name: string;
  width: number;
  height: number;
  node?: FigmaNode;
}

export async function captureFigma(url: string): Promise<CapturedEvidence> {
  const key = parseFigmaKey(url);
  if (!key) throw new Error("Could not parse a Figma file key from that URL.");

  const startId = parseFigmaNodeId(url);
  let chosen: ChosenFrame[] = [];
  let mode = "";
  let totalSeen = 0;

  // 1) Preferred: follow the prototype flow from the URL's start node.
  if (startId) {
    const flow = await collectFlowFrames(key, startId);
    if (flow.length) {
      chosen = flow;
      totalSeen = flow.length;
      mode = "prototype flow";
    }
  }

  // 2) Fallback: no node-id, or the flow had no wired navigation — grab the
  //    top-level frames across the file's pages.
  if (chosen.length === 0) {
    const fileRes = await fetch(`${FIGMA_API}/files/${key}?depth=4`, {
      headers: headers(),
    });
    if (!fileRes.ok) {
      const body = await fileRes.text();
      throw new Error(
        `Figma file fetch failed (${fileRes.status}). Is the link shared and the token valid? ${body.slice(0, 200)}`,
      );
    }
    const doc: FigmaNode = (await fileRes.json()).document;
    const all = collectFrames(doc);
    if (all.length === 0) throw new Error("No frames found in the Figma file.");
    totalSeen = all.length;
    chosen = all.slice(0, MAX_FRAMES);
    // attach subtree nodes for the outline
    const byId = new Map<string, FigmaNode>();
    for (const page of doc.children ?? [])
      for (const c of page.children ?? []) byId.set(c.id, c);
    chosen = chosen.map((c) => ({ ...c, node: byId.get(c.id) }));
    mode = startId
      ? "top-level frames (no prototype flow found from the start node)"
      : "top-level frames (no start node in URL)";
  }

  const labeled = uniqueLabels(chosen.slice(0, MAX_FRAMES));

  // Render the chosen frames to PNG.
  const ids = labeled.map((f) => f.id).join(",");
  const imgRes = await fetch(
    `${FIGMA_API}/images/${key}?ids=${encodeURIComponent(ids)}&format=png&scale=${RENDER_SCALE}`,
    { headers: headers() },
  );
  if (!imgRes.ok) throw new Error(`Figma image render failed (${imgRes.status}).`);
  const imageMap: Record<string, string | null> = (await imgRes.json()).images ?? {};

  const images: { label: string; base64: string }[] = [];
  const frameRefs: FigmaFrameRef[] = [];
  const structureLines: string[] = [];
  for (const f of labeled) {
    const pngUrl = imageMap[f.id];
    if (!pngUrl) continue;
    const png = await fetch(pngUrl);
    if (!png.ok) continue;
    const buf = Buffer.from(await png.arrayBuffer());
    images.push({ label: f.label, base64: buf.toString("base64") });
    frameRefs.push({
      label: f.label,
      node_id: f.id,
      width: f.width,
      height: f.height,
    });
    structureLines.push(`### Frame: ${f.label}`);
    if (f.node) outline(f.node, 0, structureLines);
  }

  return {
    kind: "figma",
    url,
    images,
    structure: structureLines.join("\n").slice(0, 12000),
    note: `Captured ${images.length} frame(s) via ${mode} from Figma file ${key}${
      totalSeen > images.length ? ` (more available; capped at ${MAX_FRAMES})` : ""
    }.`,
    frames: frameRefs,
    fileKey: key,
  };
}

// --- Posting comments -------------------------------------------------------

export interface CommentItem {
  message: string;
  node_id: string;
  // normalized 0..1 within the frame
  nx: number;
  ny: number;
  nw: number;
  nh: number;
  width: number; // frame px
  height: number; // frame px
}

export interface CommentResult {
  ok: boolean;
  comment_id?: string;
  error?: string;
}

async function postOne(
  fileKey: string,
  item: CommentItem,
): Promise<CommentResult> {
  const x = Math.max(0, item.nx * item.width);
  const y = Math.max(0, item.ny * item.height);
  const regionW = Math.max(8, item.nw * item.width);
  const regionH = Math.max(8, item.nh * item.height);

  // Try a highlighted region first; fall back to a point pin if Figma rejects it.
  const attempts = [
    {
      node_id: item.node_id,
      node_offset: { x, y },
      region_height: regionH,
      region_width: regionW,
      comment_pin_corner: "top_left",
    },
    { node_id: item.node_id, node_offset: { x, y } },
  ];

  let lastErr = "";
  for (const client_meta of attempts) {
    const res = await fetch(`${FIGMA_API}/files/${fileKey}/comments`, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ message: item.message, client_meta }),
    });
    if (res.ok) {
      const json = await res.json();
      return { ok: true, comment_id: json.id };
    }
    lastErr = `${res.status} ${(await res.text()).slice(0, 160)}`;
    // 403 = scope/permission — no point trying the fallback shape.
    if (res.status === 403) break;
  }
  return { ok: false, error: lastErr };
}

// Post comments sequentially (Figma rate-limits); one failure never aborts the batch.
export async function postComments(
  fileKey: string,
  items: CommentItem[],
): Promise<CommentResult[]> {
  const results: CommentResult[] = [];
  for (const item of items) {
    try {
      results.push(await postOne(fileKey, item));
    } catch (e: any) {
      results.push({ ok: false, error: e?.message || "post failed" });
    }
  }
  return results;
}
