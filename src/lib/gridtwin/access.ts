export const roleLabels = { field_team: "Field team", validation_team: "Validation team", admin: "Admin", user: "Utilizator" } as const;
export type AppRole = keyof typeof roleLabels;
export function permissions(roles: readonly AppRole[]) {
  const admin = roles.includes("admin");
  return { admin, submit: admin || roles.includes("field_team"), validate: admin || roles.includes("validation_team"), view: roles.length > 0 };
}