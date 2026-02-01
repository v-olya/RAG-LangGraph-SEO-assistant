interface BadgeProps {
  label: string;
  type: string;
  className?: string;
}

export const Badge = ({ label, type, className = "" }: BadgeProps) => {
  let colorClass: string;
  switch (type) {
    case "status":
      colorClass = "bg-emerald-100 text-emerald-700";
      break;
    case "cluster":
      colorClass = "bg-blue-100 text-blue-700";
      break;
    case "intent":
      colorClass = "bg-purple-100 text-purple-700";
      break;
    default:
      colorClass = "bg-gray-100 text-gray-700";
  }

  return (
    <span className={`${colorClass} px-2 py-0.5 rounded ${className}`.trim()}>
      {label}
    </span>
  );
};
