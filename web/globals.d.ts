// TS 6.0 requires explicit module declarations for side-effect imports of
// non-TS files. Next's bundled declarations stopped covering CSS imports
// under stricter resolution.
declare module '*.css';
