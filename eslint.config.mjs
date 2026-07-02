import nextConfig from "eslint-config-next";

const eslintConfig = [
  ...nextConfig,
  {
    ignores: ["supabase/**", "node_modules/**", ".next/**"],
  },
];

export default eslintConfig;
