import type { CSSProperties } from 'react';

const agents = [
  ['REQ', 'Requirements', 'Agent'],
  ['ORC', 'Orchestrator', 'Agent'],
  ['TST', 'Test Case', 'Agent'],
  ['AUT', 'Automation', 'Agent'],
  ['RUN', 'Execution', 'Agent'],
  ['RPT', 'Reporting', 'Agent'],
  ['BUG', 'Bug Healing', 'Agent'],
  ['KNO', 'Knowledge', 'Agent']
];

export function ProductOrbit3D() {
  return (
    <div className="product-orbit-3d" aria-hidden="true">
      <div className="orbit-floor" />
      <div className="orbit-pedestal">
        <span />
        <span />
        <span />
      </div>
      <div className="orbit-ring orbit-ring-a" />
      <div className="orbit-ring orbit-ring-b" />
      <div className="orbit-ring orbit-ring-c" />
      <div className="orbit-ring orbit-ring-d" />
      <div className="orbit-core">
        <span>TP</span>
        <strong>AI Core</strong>
      </div>
      <div className="orbit-path">
        {agents.map(([code, title, caption], nodeIndex) => (
          <div
            className="orbit-node"
            key={title}
            style={{ '--orbit-index': nodeIndex } as CSSProperties & Record<string, number>}
          >
            <span>{code}</span>
            <strong>{title}</strong>
            <small>{caption}</small>
          </div>
        ))}
      </div>
      <div className="agent-dock">
        <strong>All agents working together</strong>
        <div>
          {agents.slice(0, 6).map(([code]) => <span key={code}>{code.slice(0, 1)}</span>)}
        </div>
      </div>
      <div className="orbit-beam orbit-beam-a" />
      <div className="orbit-beam orbit-beam-b" />
      <div className="orbit-beam orbit-beam-c" />
    </div>
  );
}
