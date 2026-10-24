export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-4">
      <div className="skeleton h-12 w-2/3 max-w-md" />
      <div className="skeleton h-5 w-1/2 max-w-sm" />
      <div className="mt-4 flex flex-col gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton h-20 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
