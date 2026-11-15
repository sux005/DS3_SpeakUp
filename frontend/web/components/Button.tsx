import Link from "next/link";
import type { ComponentProps } from "react";

type Variant = "primary" | "secondary" | "accent";

const variants: Record<Variant, string> = {
  // Orange marks the one main action on a screen.
  primary: "bg-peach text-night",
  secondary: "bg-card text-ink",
  accent: "bg-peach text-night",
};

const base =
  "btn inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-outline px-5 text-[15px] font-semibold";

export function buttonClass(variant: Variant = "primary") {
  return `${base} ${variants[variant]}`;
}

export function ButtonLink({
  variant,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={buttonClass(variant)} {...props} />;
}

export function Button({
  variant,
  ...props
}: ComponentProps<"button"> & { variant?: Variant }) {
  return <button type="button" className={buttonClass(variant)} {...props} />;
}
