export const isSshAgentNoneValue = (value: string | undefined): boolean => {
  if (typeof value !== "string") return false;
  return value.trim().replace(/^["']|["']$/g, "").trim().toLowerCase() === "none";
};
