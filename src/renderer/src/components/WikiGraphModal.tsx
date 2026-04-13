import { useEffect, useMemo, useRef, useState } from 'react';
import type { WikiGraph, WikiGraphNode } from '@shared/types';
import { bridge } from '../api/bridge';
import { useSourcePreview } from '../store/sourcePreview';

/**
 * A cute, gimmicky Obsidian-style view of the research wiki. Renders a force-
 * directed graph of sources + the wikilinks between them (edges come from the
 * LLM citing related sources inside its own summaries — see wiki.computeWikiGraph).
 *
 * Deliberately low-fidelity: it's a trust signal for the user ("look at what the
 * agent is building under the hood"), not a serious analysis tool. The sim
 * runs ~400 ticks on mount and freezes — no drag, no pan/zoom.
 */

interface SimNode extends WikiGraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface SimEdge {
  source: string;
  target: string;
}

const WIDTH = 720;
const HEIGHT = 520;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;
const SIM_TICKS = 400;
const REPULSION = 2600;
const SPRING = 0.035;
const SPRING_LENGTH = 130;
const CENTER_GRAVITY = 0.015;
const DAMPING = 0.84;

function runSimulation(nodes: SimNode[], edges: SimEdge[]): void {
  if (nodes.length === 0) return;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  for (let tick = 0; tick < SIM_TICKS; tick++) {
    // repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distSq = dx * dx + dy * dy || 0.01;
        const dist = Math.sqrt(distSq);
        const force = REPULSION / distSq;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    // spring edges
    for (const e of edges) {
      const a = byId.get(e.source);
      const b = byId.get(e.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const delta = dist - SPRING_LENGTH;
      const fx = (dx / dist) * delta * SPRING;
      const fy = (dy / dist) * delta * SPRING;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    // gravity to center + damping + integrate
    for (const n of nodes) {
      n.vx += (CENTER_X - n.x) * CENTER_GRAVITY;
      n.vy += (CENTER_Y - n.y) * CENTER_GRAVITY;
      n.vx *= DAMPING;
      n.vy *= DAMPING;
      n.x += n.vx;
      n.y += n.vy;
    }
  }
}

function seedNodes(graph: WikiGraph): SimNode[] {
  const n = graph.nodes.length;
  if (n === 0) return [];
  const radius = Math.min(WIDTH, HEIGHT) * 0.28;
  return graph.nodes.map((node, i) => {
    const angle = (2 * Math.PI * i) / Math.max(n, 1);
    return {
      ...node,
      x: CENTER_X + Math.cos(angle) * radius,
      y: CENTER_Y + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    };
  });
}

export function WikiGraphModal({ onClose }: { onClose: () => void }): JSX.Element {
  const [graph, setGraph] = useState<WikiGraph | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const openPreview = useSourcePreview((s) => s.open);

  useEffect(() => {
    bridge.wiki.graph().then(setGraph).catch(console.error);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const simNodes = useMemo<SimNode[]>(() => {
    if (!graph) return [];
    const nodes = seedNodes(graph);
    runSimulation(nodes, graph.edges);
    return nodes;
  }, [graph]);

  const nodeById = useMemo(() => new Map(simNodes.map((n) => [n.id, n])), [simNodes]);
  const hovered = hoverId ? nodeById.get(hoverId) ?? null : null;

  const sourceCount = graph?.nodes.length ?? 0;
  const edgeCount = graph?.edges.length ?? 0;

  const handleNodeClick = (id: string): void => {
    const graphNode = graph?.nodes.find((n) => n.id === id);
    if (!graphNode) return;
    // Hydrate into the full SourceMeta the preview expects. We only carry what
    // the graph exposes, so the preview fetches the full summary on open.
    bridge.sources.list().then((all) => {
      const full = all.find((s) => s.slug === id);
      if (full) openPreview(full);
    });
    onClose();
  };

  return (
    <div className="wiki-graph-overlay" onClick={onClose}>
      <div className="wiki-graph-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wiki-graph-header">
          <div>
            <h3>Research Wiki</h3>
            <div className="wiki-graph-sub">
              {sourceCount} source{sourceCount === 1 ? '' : 's'} · {edgeCount} link
              {edgeCount === 1 ? '' : 's'}
            </div>
          </div>
          <button type="button" className="source-preview-close" onClick={onClose} aria-label="Close">
            &#x2715;
          </button>
        </div>

        <div className="wiki-graph-canvas-wrap">
          {!graph && <div className="wiki-graph-empty">Loading…</div>}
          {graph && sourceCount === 0 && (
            <div className="wiki-graph-empty">
              No sources yet. Drop some into the Sources panel and the agent will start
              weaving them together here.
            </div>
          )}
          {graph && sourceCount > 0 && (
            <svg
              className="wiki-graph-svg"
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              preserveAspectRatio="xMidYMid meet"
            >
              <g>
                {graph.edges.map((e, i) => {
                  const a = nodeById.get(e.source);
                  const b = nodeById.get(e.target);
                  if (!a || !b) return null;
                  const active = hoverId === e.source || hoverId === e.target;
                  return (
                    <line
                      key={`${e.source}->${e.target}-${i}`}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      className={active ? 'wiki-graph-edge wiki-graph-edge-active' : 'wiki-graph-edge'}
                    />
                  );
                })}
              </g>
              <g>
                {simNodes.map((n) => {
                  const active = hoverId === n.id;
                  return (
                    <g
                      key={n.id}
                      className="wiki-graph-node-g"
                      onMouseEnter={() => setHoverId(n.id)}
                      onMouseLeave={() => setHoverId(null)}
                      onClick={() => handleNodeClick(n.id)}
                    >
                      <circle
                        cx={n.x}
                        cy={n.y}
                        r={active ? 9 : 7}
                        className={active ? 'wiki-graph-node wiki-graph-node-active' : 'wiki-graph-node'}
                      />
                      <text
                        x={n.x}
                        y={n.y + 20}
                        textAnchor="middle"
                        className="wiki-graph-label"
                      >
                        {n.name.length > 22 ? `${n.name.slice(0, 20)}…` : n.name}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          )}
        </div>

        <div className="wiki-graph-tooltip">
          {hovered ? (
            <>
              <div className="wiki-graph-tooltip-name">{hovered.name}</div>
              <div className="wiki-graph-tooltip-summary">{hovered.indexSummary}</div>
            </>
          ) : (
            <div className="wiki-graph-tooltip-hint">Hover a node to see its summary · click to open the source.</div>
          )}
        </div>

        <div className="wiki-graph-footer">
          Hidden under <code>.myst/wiki/</code> · the agent reads this on every turn.
        </div>
      </div>
    </div>
  );
}
