import { Link } from "react-router-dom";
import { useIsDark } from "../lib/auth";
import { courseStyle } from "../lib/courses";
import { cx } from "./ui";

/** A small colored course code, the same color for a course everywhere. */
export function CourseChip({ code, link = true, className }: { code?: string | null; link?: boolean; className?: string }) {
  const dark = useIsDark();
  if (!code) return null;
  const chip = (
    <span style={courseStyle(code, dark)} className={cx("inline-flex items-center rounded-md border-l-2 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide leading-4 whitespace-nowrap", className)}>
      {code}
    </span>
  );
  return link ? <Link to={`/courses/${encodeURIComponent(code)}`}>{chip}</Link> : chip;
}
