// MathJax v3 configuration. Loaded before vendor/mathjax/tex-chtml-full.js.
//
// The page ships `tex-chtml-full`: the tex-chtml component with every TeX
// package statically bundled, so nothing is fetched at typeset time and the
// page works offline from file://.
window.MathJax = {
  tex: {
    inlineMath: [
      ['$', '$'],
      // Pandoc emits \( \) under --mathjax. build.mjs rewrites those to $ $, but
      // keeping the Pandoc delimiters registered removes any chance of a span
      // being left un-typeset if that rewrite is ever changed.
      ['\\(', '\\)'],
    ],
    displayMath: [
      ['$$', '$$'],
      ['\\[', '\\]'],
    ],
    processEscapes: true,
    processEnvironments: true,
    // Every package below is already inside tex-chtml-full; listing them keeps
    // this file usable if the build is ever switched to the slim component.
    packages: {
      '[+]': ['ams', 'boldsymbol', 'braket', 'cases', 'centernot', 'mathtools'],
    },
  },
  options: {
    enableMenu: true,
    // Never let MathJax descend into verbatim blocks.
    skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
  },
  chtml: {
    scale: 1.0,
    displayAlign: 'center',
    displayIndent: '0',
  },
};
