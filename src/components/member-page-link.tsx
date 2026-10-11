"use client";

import Link, { useLinkStatus } from "next/link";

function PageLabel({ children }: { children: string }) {
  const { pending } = useLinkStatus();
  return <span aria-live="polite" aria-busy={pending}>{pending ? "Loading members…" : children}</span>;
}

export function MemberPageLink({ href, children }: { href: string; children: string }) {
  return <Link href={href} prefetch={false} className="text-sm underline"><PageLabel>{children}</PageLabel></Link>;
}
