export function optionValue(args: string[], name: string, fallback = ''): string {
  // Support `--flag=value`.
  const inline = args.find((a) => a.startsWith(`${name}=`));
  if (inline !== undefined) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) return fallback;
  const next = args[index + 1]!;
  // A following flag-like token (`--other`) means this flag's value was omitted —
  // don't silently consume the next flag as the value.
  return next.startsWith('--') ? fallback : next;
}
