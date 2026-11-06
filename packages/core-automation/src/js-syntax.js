import vm from 'node:vm';

/** Throws if `code` (a function body) is not valid JavaScript. Compiles only; nothing runs. */
export function checkJsSyntax(code) {
  new vm.Script(`(function () {\n"use strict";\n${code}\n})`, { filename: 'rule.js' });
}
