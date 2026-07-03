import type { ComponentPropsWithoutRef, ReactNode } from "react";

function Attachment({ className = "", ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={`attachment ${className}`.trim()} {...props} />;
}

function AttachmentMedia({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`attachment-media ${className}`.trim()}>{children}</div>;
}

function AttachmentContent({ children }: { children: ReactNode }) {
  return <div className="attachment-content">{children}</div>;
}

function AttachmentTitle({ children }: { children: ReactNode }) {
  return <strong className="attachment-title">{children}</strong>;
}

function AttachmentDescription({ children }: { children: ReactNode }) {
  return <span className="attachment-description">{children}</span>;
}

function AttachmentActions({ children }: { children: ReactNode }) {
  return <div className="attachment-actions">{children}</div>;
}

function AttachmentAction({ className = "", ...props }: ComponentPropsWithoutRef<"button">) {
  return <button className={`attachment-action ${className}`.trim()} type="button" {...props} />;
}

export {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
};
