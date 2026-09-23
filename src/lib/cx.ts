/** Joins class names, skipping empty and false ones. */
export const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");
