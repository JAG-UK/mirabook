export default function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-stone-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-stone-600" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  )
}
