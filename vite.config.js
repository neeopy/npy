import { fumanBuild } from '@fuman/build/vite'
import { nodeExternals } from 'rollup-plugin-node-externals'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

const config = defineConfig(() => {
    return {
        build: {
            target: 'esnext',
            rollupOptions: {
                output: {
                    // re-exported namespaces can't be tree-shaken when bundled
                    // see: https://github.com/rollup/rollup/issues/5161
                    preserveModules: true,
                },
            },
        },
        plugins: [
            nodeExternals(),
            fumanBuild({
                root: __dirname,
                insertTypesEntry: true,
            }),
            dts({
                exclude: ['**/*.test.ts', '**/benchmarks/**'],
            }),
        ],
    }
})

export default config