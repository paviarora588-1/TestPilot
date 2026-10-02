export function ApprovalModal({ title = 'Approval Required', body = 'This action is gated by TestPilot AI readiness rules.' }: { title?: string; body?: string }) {
  return (
    <div className="rounded-2xl border border-blue-500/[0.25] bg-blue-500/[0.08] p-4 text-sm text-blue-300">
      <strong className="text-blue-200">{title}</strong>
      <p className="mt-1 text-blue-300/80">{body}</p>
    </div>
  );
}
