const CopyPlugin = require('copy-webpack-plugin')
const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    swcMinify: true,
    output: 'export',

    images: {
        unoptimized: true, // Required for static export
    },
    // Webpack configuration for Monaco Editor
    webpack: (config, { isServer }) => {
        // Handle Monaco editor worker files
        if (!isServer) {
            config.resolve.fallback = {
                ...config.resolve.fallback,
                fs: false,
                path: false,
            }

            // Copy Monaco Editor files to static directory for local loading
            config.plugins.push(
                new CopyPlugin({
                    patterns: [
                        {
                            from: path.join(__dirname, 'node_modules/monaco-editor/min/vs'),
                            to: path.join(__dirname, 'public/monaco-editor/min/vs'),
                        },
                    ],
                })
            )
        }
        return config
    },
}

module.exports = nextConfig