/** @type {import('@fuman/build').RootConfig} */
export default {
    jsr: {
        exclude: [
            "**/*.{test,bench}.ts",
            "**/__fixtures__/**",
            "**/benchmarks/**",
            "**/tests/**",
        ],
        sourceDir: "src",
    },
    versioning: {
        exclude: [
            "**/*.test.ts",
            "**/*.md",
            "**/examples/**",
            "**/benchmarks/**",
            "**/__fixtures__/**",
        ],
    },
    typedoc: {
        out: "docs/api",
        includeVersion: true,
        excludePrivate: true,
        excludeExternals: true,
        excludeInternal: true,
        validation: {
            notExported: true,
            invalidLink: true,
            notDocumented: false,
        },
    },
};
