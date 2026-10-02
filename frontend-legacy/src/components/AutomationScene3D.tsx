import type { CSSProperties } from 'react';

export function AutomationScene3D({ compact = false }: { compact?: boolean }) {
  const flow = ['Product', 'Knowledge', 'Library', 'Test Cases', 'AI Mapping', 'Script Review', 'Safe Run', 'Reports'];

  return (
    <div className={`scene-3d ${compact ? 'scene-3d-compact' : ''}`} aria-hidden="true">
      <div className="scene-3d-grid" />
      <div className="scene-3d-ring scene-3d-ring-one" />
      <div className="scene-3d-ring scene-3d-ring-two" />
      <div className="scene-flow-orbit">
        {flow.map((item, index) => (
          <div key={item} className="scene-flow-node" style={{ '--node-index': index } as CSSProperties & Record<string, number>}>
            <span>{index + 1}</span>
            <strong>{item}</strong>
          </div>
        ))}
      </div>
      <div className="scene-3d-platform">
        <div className="scene-3d-layer scene-3d-layer-back">
          <span />
          <span />
          <span />
        </div>
        <div className="scene-3d-layer scene-3d-layer-mid">
          <span />
          <span />
          <span />
        </div>
        <div className="scene-3d-layer scene-3d-layer-front">
          <span />
          <span />
          <span />
        </div>
        <div className="scene-3d-core">
          <strong>AI</strong>
          <span>Agent</span>
        </div>
        <div className="scene-3d-column scene-3d-column-one" />
        <div className="scene-3d-column scene-3d-column-two" />
        <div className="scene-3d-column scene-3d-column-three" />
        <div className="scene-3d-beam scene-3d-beam-one" />
        <div className="scene-3d-beam scene-3d-beam-two" />
      </div>
      <div className="scene-3d-chip scene-3d-chip-left">
        <strong>Knowledge</strong>
        <span>Processed</span>
      </div>
      <div className="scene-3d-chip scene-3d-chip-right">
        <strong>Library</strong>
        <span>Mapped</span>
      </div>
      <div className="scene-3d-chip scene-3d-chip-bottom">
        <strong>Scripts</strong>
        <span>Reviewed</span>
      </div>
    </div>
  );
}
