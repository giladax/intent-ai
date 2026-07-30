// Ambient declarations for side-effect asset imports (Vite serves these;
// tsc only needs to know they exist). Root `npm run typecheck:ui` runs
// TS 6, which errors (TS2882) on undeclared side-effect imports.
declare module "*.css";
declare module "@fontsource-variable/newsreader";
