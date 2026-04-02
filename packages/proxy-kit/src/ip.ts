export interface Options {
    includeBoundaries?: boolean;
    exact?: boolean;
}

const word = "[a-fA-F\\d:]";

const boundry = (options?: Options) =>
    options?.includeBoundaries
        ? `(?:(?<=\\s|^)(?=${word})|(?<=${word})(?=\\s|$))`
        : "";
const v4 =
    "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)){3}";
const v6segment = "[a-fA-F\\d]{1,4}";
const v6 = `
(?:
(?:${v6segment}:){7}(?:${v6segment}|:)|
(?:${v6segment}:){6}(?:${v4}|:${v6segment}|:)|
(?:${v6segment}:){5}(?::${v4}|(?::${v6segment}){1,2}|:)|
(?:${v6segment}:){4}(?:(?::${v6segment}){0,1}:${v4}|(?::${v6segment}){1,3}|:)|
(?:${v6segment}:){3}(?:(?::${v6segment}){0,2}:${v4}|(?::${v6segment}){1,4}|:)|
(?:${v6segment}:){2}(?:(?::${v6segment}){0,3}:${v4}|(?::${v6segment}){1,5}|:)|
(?:${v6segment}:){1}(?:(?::${v6segment}){0,4}:${v4}|(?::${v6segment}){1,6}|:)|
(?::(?:(?::${v6segment}){0,5}:${v4}|(?::${v6segment}){1,7}|:))
)(?:%[0-9a-zA-Z]{1,})?
`
    .replace(/\s*\/\/.*$/gm, "")
    .replace(/\n/g, "")
    .trim();

const v46Exact = new RegExp(`(?:^${v4}$)|(?:^${v6}$)`);
const v4exact = new RegExp(`^${v4}$`);
const v6exact = new RegExp(`^${v6}$`);

export const ipRegex = (options?: Options): RegExp =>
    options?.exact
        ? v46Exact
        : new RegExp(
              `(?:${boundry(options)}${v4}${boundry(options)})|(?:${boundry(options)}${v6}${boundry(options)})`,
              "g",
          );

ipRegex.v4 = (options?: Options): RegExp =>
    options?.exact
        ? v4exact
        : new RegExp(`${boundry(options)}${v4}${boundry(options)}`, "g");
ipRegex.v6 = (options?: Options): RegExp =>
    options?.exact
        ? v6exact
        : new RegExp(`${boundry(options)}${v6}${boundry(options)}`, "g");

export default ipRegex;
