/** Literal switch so i18nKeys.test.ts sees every key; only character roles are a closed enum worth translating. */
export function characterRoleLabel(role: string | null | undefined, t: (k: string) => string): string {
  switch (role) {
    case "MAIN":
      return t("detail.roleMain");
    case "SUPPORTING":
      return t("detail.roleSupporting");
    case "BACKGROUND":
      return t("detail.roleBackground");
    default:
      return "";
  }
}
