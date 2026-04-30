interface Props {
  message: string | null | undefined;
}

export default function AuthFormError({ message }: Props) {
  if (!message) return null;
  return <p className="text-xs text-red-500 mt-1.5">{message}</p>;
}
