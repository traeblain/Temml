/**
 * The Lexer class handles tokenizing the input in various ways. Since our
 * parser expects us to be able to backtrack, the lexer allows lexing from any
 * given starting point.
 *
 * Its main exposed function is the `lex` function, which takes a position to
 * lex from and a type of token to lex. It defers to the appropriate `_innerLex`
 * function.
 *
 * The various `_innerLex` functions perform the actual lexing of different
 * kinds.
 */

import ParseError from "./ParseError";
import SourceLocation from "./SourceLocation";
import { Token } from "./Token";

/* The following tokenRegex
 * - matches typical whitespace (but not NBSP etc.) using its first two groups
 * - does not match any control character \x00-\x1f except whitespace
 * - does not match a bare backslash
 * - matches any ASCII character except those just mentioned
 * - does not match the BMP private use area \uE000-\uF8FF
 * - does not match bare surrogate code units
 * - matches any BMP character except for those just described
 * - matches any valid Unicode surrogate pair
 * - mathches numerals
 * - matches a backslash followed by one or more whitespace characters
 * - matches a backslash followed by one or more letters then whitespace
 * - matches a backslash followed by any BMP character
 * Capturing groups:
 *   [1] regular whitespace
 *   [2] backslash followed by whitespace
 *   [3] anything else, which may include:
 *     [4] left character of \verb*
 *     [5] left character of \verb
 *     [6] backslash followed by word, excluding any trailing whitespace
 * Just because the Lexer matches something doesn't mean it's valid input:
 * If there is no matching function or symbol definition, the Parser will
 * still reject the input.
 */
const spaceRegexString = "[ \r\n\t]";
const controlWordRegexString = "\\\\[a-zA-Z@]+";
const controlSymbolRegexString = "\\\\[^\uD800-\uDFFF]";
const controlWordWhitespaceRegexString = `(${controlWordRegexString})${spaceRegexString}*`
const controlSpaceRegexString = "\\\\(\n|[ \r\t]+\n?)[ \r\t]*";
const combiningDiacriticalMarkString = "[\u0300-\u036f]";
export const combiningDiacriticalMarksEndRegex = new RegExp(`${combiningDiacriticalMarkString}+$`);
const tokenRegexString =
  `(${spaceRegexString}+)|` + // whitespace
  `${controlSpaceRegexString}|` +  // whitespace
  "(number" +         // numbers (in non-strict mode)
  "|[!-\\[\\]-\u2027\u202A-\uD7FF\uF900-\uFFFF]" + // single codepoint
  `${combiningDiacriticalMarkString}*` + // ...plus accents
  "|[\uD800-\uDBFF][\uDC00-\uDFFF]" + // surrogate pair
  `${combiningDiacriticalMarkString}*` + // ...plus accents
  "|\\\\verb\\*([^]).*?\\4" + // \verb*
  "|\\\\verb([^*a-zA-Z]).*?\\5" + // \verb unstarred
  `|${controlWordWhitespaceRegexString}` + // \macroName + spaces
  `|${controlSymbolRegexString})`; // \\, \', etc.

/** Main Lexer class */
export default class Lexer {
  constructor(input, settings) {
    // Separate accents from characters
    this.input = input;
    this.settings = settings;
    this.tokenRegex = new RegExp(
      // Strict Temml, like TeX, lexes one numeral at a time.
      // Default Temml lexes contiguous numerals into a single <mn> element.
      tokenRegexString.replace("number|", settings.strict ? "" : "\\d(?:[\\d,.]*\\d)?|"),
      "g"
    );
    // Category codes. The lexer only supports comment characters (14) for now.
    // MacroExpander additionally distinguishes active (13).
    this.catcodes = {
      "%": 14, // comment character
      "~": 13  // active character
    };
  }

  setCatcode(char, code) {
    this.catcodes[char] = code;
  }

  /**
   * This function lexes a single token.
   */
  lex() {
    const input = this.input;
    const pos = this.tokenRegex.lastIndex;
    if (pos === input.length) {
      return new Token("EOF", new SourceLocation(this, pos, pos));
    }
    const match = this.tokenRegex.exec(input);
    if (match === null || match.index !== pos) {
      throw new ParseError(
        `Unexpected character: '${input[pos]}'`,
        new Token(input[pos], new SourceLocation(this, pos, pos + 1))
      );
    }
    const text = match[6] || match[3] || (match[2] ? "\\ " : " ")

    if (this.catcodes[text] === 14) {
      // comment character
      const nlIndex = input.indexOf("\n", this.tokenRegex.lastIndex);
      if (nlIndex === -1) {
        this.tokenRegex.lastIndex = input.length; // EOF
        if (this.settings.strict) {
          throw new ParseError("% comment has no terminating newline; LaTeX would " +
              "fail because of commenting the end of math mode")
        }
      } else {
        this.tokenRegex.lastIndex = nlIndex + 1;
      }
      return this.lex();
    }

    return new Token(text, new SourceLocation(this, pos, this.tokenRegex.lastIndex));
  }
}
