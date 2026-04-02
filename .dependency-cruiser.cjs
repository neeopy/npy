const fs = require('node:fs')
const { join } = require('node:path')

const packages = fs.readdirSync('packages')

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
    forbidden: [
        {
            name: 'no-circular',
            severity: 'error',
            comment:
                'This dependency is part of a circular relationship. You might want to revise '
                + 'your solution (i.e. use dependency inversion, make sure the modules have a single responsibility) ',
            from: {},
            to: {
                circular: true,
                dependencyTypesNot: ['type-only'],
            },
        },
        {
            name: 'no-orphans',
            comment:
                "This is an orphan module - it's likely not used (anymore?). Either use it or remove it",
            severity: 'error',
            from: {
                orphan: true,
                pathNot: [
                    '(^|/)[.][^/]+[.](?:js|cjs|mjs|ts|cts|mts|json)$',
                    '[.]d[.]ts$',
                    '(^|/)tsconfig[.]json$',
                    '(^|/)bunfig[.]toml$',
                    '(^|/)(?:vite|build|eslint|bun)[.]config[.](?:js|cjs|mjs|ts|cts|mts|json)$',
                ],
            },
            to: {},
        },
        ...packages.map((pkg) => {
            const pkgJson = JSON.parse(fs.readFileSync(join('packages', pkg, 'package.json'), 'utf8'))
            const from = [
                ...Object.values(pkgJson.exports ?? {}),
                ...Object.values(pkgJson.bin ?? {}),
            ]

            return ({
                name: `${pkg}_no-unreachable-from-root`,
                severity: 'error',
                from: {
                    path: from,
                },
                to: {
                    path: `packages/${pkg}/src`,
                    pathNot: [
                        '\\.(test|bench)\\.(js|ts)$|\\.d\\.ts$',
                        ...from,
                    ],
                    reachable: false,
                },
            })
        }),
        {
            name: 'not-to-deprecated',
            comment:
                'This module uses a (version of an) npm module that has been deprecated. Either upgrade to a later '
                + 'version of that module, or find an alternative. Deprecated modules are a security risk.',
            severity: 'error',
            from: {},
            to: {
                dependencyTypes: [
                    'deprecated',
                ],
            },
        },
        {
            name: 'no-duplicate-dep-types',
            comment:
                "Likely this module depends on an external ('npm') package that occurs more than once "
                + 'in your package.json i.e. both as a devDependencies and in dependencies. This will cause '
                + 'maintenance problems later on.',
            severity: 'error',
            from: {},
            to: {
                moreThanOneDependencyType: true,
                dependencyTypesNot: ['type-only', 'npm-peer'],
            },
        },
        {
            name: 'not-to-spec',
            comment:
                'This module depends on a spec (test) file. The sole responsibility of a spec file is to test code. '
                + "If there's something in a spec that's of use to other modules, it doesn't have that single "
                + 'responsibility anymore. Factor it out into (e.g.) a separate utility/ helper or a mock.',
            severity: 'error',
            from: {},
            to: {
                path: '[.](?:spec|test)[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$',
            },
        },
        {
            name: 'not-to-dev-dep',
            severity: 'error',
            comment:
                "This module depends on an npm package from the 'devDependencies' section of your "
                + 'package.json. It looks like something that ships to production, though. To prevent problems '
                + "with npm packages that aren't there on production declare it (only!) in the 'dependencies'"
                + 'section of your package.json. If this module is development only - add it to the '
                + 'from.pathNot re of the not-to-dev-dep rule in the dependency-cruiser configuration',
            from: {
                path: '^(packages)',
                pathNot: [
                    '[.](?:spec|test|bench)[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$',
                    'packages/fetch/src/addons/parse/adapters/.*',
                    'packages/node/src/net/websocket.ts',
                ],
            },
            to: {
                dependencyTypes: [
                    'npm-dev',
                ],
                dependencyTypesNot: [
                    'type-only',
                ],
                pathNot: [
                    'node_modules/@types/',
                ],
            },
        },
    ],
    options: {
        doNotFollow: {
            path: [
                'node_modules',
                'dist',
                '__fixtures__',
                'coverage',
                '.bun',
                '.bun-cache',
            ],
        },
        moduleSystems: ['cjs', 'es6'],
        tsPreCompilationDeps: true,
        tsConfig: {
            fileName: 'tsconfig.json',
        },
        enhancedResolveOptions: {
            exportsFields: ['exports'],
            conditionNames: [
                'bun',
                'import',
                'require',
                'node',
                'default',
                'types',
            ],
            mainFields: ['module', 'main', 'types', 'typings'],
        },
        reporterOptions: {
            text: {
                highlightFocused: true,
            },
        },
    },
}