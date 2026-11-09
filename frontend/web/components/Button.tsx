import Link from "next/link";
import type { ComponentProps } from "react";

type Variant = "primary" | "secondary" | "accent";

const variants: Record<Variant, string> = {
  primary: "border-teal bg-teal text-cream",
  secondary: "border-ink bg-pale text-ink",
  accent: "border-peach bg-peach text-night",
};

const base =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md border px-6 text-sm font-semibold transition-opacity hover:opacity-85";

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
