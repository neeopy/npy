import tlds from "tlds";
import type { StrictOptions } from "./types";

const alphabets = "a-z";
const numbers = "0-9";
const labelLetters = `${alphabets}${numbers}\\u00a1-\\uffff`;
const relaxedLabelLetters = `${labelLetters}_`;
const relaxedLabelLettersWithHyphen = `${relaxedLabelLetters}-`;
const idnPrefix = "xn--";

const nonDigitTwoOrMoreLabelWithHyphen = `[${alphabets}\\-]{2,63}`;

const nonStrictTld = nonDigitTwoOrMoreLabelWithHyphen;
const strictTld = `${tlds.sort((a, b) => b.length - a.length).join("|")}`;

const finalLabelStrict = `[${labelLetters}](?:[${labelLetters}\\-]{0,61}[${labelLetters}])?`;
const finalLabelRelaxed = `[${relaxedLabelLetters}](?:[${relaxedLabelLettersWithHyphen}]{0,61}[${relaxedLabelLetters}])?`;
const finalLabelIDN = `${idnPrefix}[${labelLetters}]{0,59}`;

const notFakePuny = `(?![^x][^n]--)`;

export function domainRegex(options: StrictOptions = { strict: true }): RegExp {
    const tld = options.strict ? strictTld : nonStrictTld;

    const lookahead = `(?=[${relaxedLabelLetters}\\-.]{1,252}\\.(${tld})\\b)`;

    const subdomain = `(?:${notFakePuny}(?:${finalLabelIDN}|${finalLabelRelaxed})\\.){0,126}`;

    const finalLabel = `${notFakePuny}(?:${finalLabelIDN}|${finalLabelStrict})\\.`;

    const regex = `${lookahead}${subdomain}${finalLabel}(${tld})\\b`;

    return new RegExp(regex, "gi");
}
