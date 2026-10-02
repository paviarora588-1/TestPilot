const modules = [
  ['01', 'Knowledge', 'Product brain'],
  ['02', 'Library', 'UI objects'],
  ['03', 'Mapping', 'Step intelligence'],
  ['04', 'Review', 'Risk gate'],
  ['05', 'Execution', 'Safe run'],
  ['06', 'Reports', 'Audit loop']
];

export function InfinityEngine3D() {
  return (
    <div className="infinity-engine" aria-hidden="true">
      <div className="infinity-field" />
      <div className="infinity-loop infinity-loop-left" />
      <div className="infinity-loop infinity-loop-right" />
      <div className="infinity-loop infinity-loop-glow" />
      <div className="infinity-rail infinity-rail-a" />
      <div className="infinity-rail infinity-rail-b" />
      <div className="infinity-core">
        <span>TP</span>
        <strong>AI</strong>
      </div>
      <div className="infinity-cube-shadow" />
      <div className="infinity-modules">
        {modules.map(([index, title, body], moduleIndex) => (
          <div className={`infinity-module infinity-module-${moduleIndex + 1}`} key={title}>
            <span>{index}</span>
            <strong>{title}</strong>
            <small>{body}</small>
          </div>
        ))}
      </div>
      <div className="infinity-console">
        <strong>Golden automation gates</strong>
        <span>Knowledge + library + mapping + review + safe execution</span>
      </div>
    </div>
  );
}
