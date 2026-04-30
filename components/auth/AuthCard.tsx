import type { ReactNode } from "react";

interface Props {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export default function AuthCard({ title, subtitle, children, footer }: Props) {
  return (
    <div className="w-full max-w-md">
      <div className="bg-white rounded-2xl shadow-xl">
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <h1 className="text-xl font-bold text-gray-900">{title}</h1>
          {subtitle ? (
            <p className="text-sm text-gray-500 mt-1">{subtitle}</p>
          ) : null}
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer ? (
          <div className="px-6 pb-6 pt-2 text-sm text-gray-500 text-center">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
