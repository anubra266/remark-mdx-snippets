import path from 'node:path';
import {read} from 'to-vfile';
import {remark} from 'remark';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import remarkMdx from 'remark-mdx';
import {visit} from 'unist-util-visit';

/**
 * @typedef {import('mdast').RootContent} RootContent
 * @typedef {import('mdast').Parent} Parent
 * @typedef {import('vfile').VFile} VFile
 *
 * @typedef PluginOptions
 * @property {string} [snippetsDir] - Directory to resolve snippet files from
 * @property {string} [fileAttribute] - Custom attribute name for file path (default: 'file')
 * @property {string} [elementName] - Custom element name for snippets (default: 'Snippet')
 * @property {any} [processor] - Custom processor
 */

/**
 * Plugin to process and include external snippet files in MDX
 *
 * @param {PluginOptions} [options={}]
 * @returns {(tree: RootContent, file: VFile) => Promise<void>}
 */
export function mdxSnippet(options = {}) {
	const {
		snippetsDir = path.resolve(process.cwd(), '_snippets'),
		fileAttribute = 'file',
		elementName = 'Snippet',
		processor: unified,
	} = options;

	return async (tree, file) => {
		/** @type {Promise<void>[]} */
		const queue = [];

		visit(tree, ['mdxJsxFlowElement', 'mdxJsxTextElement'], (node) => {
			if (
				(node.type !== 'mdxJsxFlowElement' &&
					node.type !== 'mdxJsxTextElement') ||
				// @ts-ignore
				node.name !== elementName
			) {
				return;
			}

			// @ts-ignore
			const fileAttr = node.attributes.find(
				(/** @type {any} */ attr) => attr.name === fileAttribute
			);

			if (!fileAttr || typeof fileAttr.value !== 'string') {
				console.warn(
					`${elementName} tag missing required "${fileAttribute}" attribute:`,
					node
				);
				return;
			}

			const filePath = path.join(snippetsDir, fileAttr.value);

			// Add dependency tracking for HMR support
			// @ts-ignore
			const compiler = /** @type {any} */ (file.data._compiler);
			if (compiler && typeof compiler.addDependency === 'function') {
				compiler.addDependency(filePath);
			}

			const promise = read(filePath, 'utf8')
				.then((snippetFile) => {
					// Construct a processor for the snippet content that includes this plugin again
					// so nested snippets are also processed.
					const snippetProcessor = (unified ?? remark())
						.use(remarkGfm)
						.use(remarkStringify)
						.use(remarkMdx)
						.use(mdxSnippet, {
							snippetsDir,
							fileAttribute,
							elementName,
							processor: unified,
						});

					// Parse and transform the snippet content
					const ast = snippetProcessor().parse(snippetFile);
					return snippetProcessor().run(ast, snippetFile);
				})
				.then((result) => {
					// Replace the node with the parsed content (first child if single, or fragment if multiple)
					// This approach is safer than splicing during visit
					if (result.children.length === 1) {
						// Single child - replace the node with the child content
						Object.assign(node, result.children[0]);
					} else {
						// Multiple children - create a fragment-like structure
						Object.assign(node, {
							type: 'mdxJsxFlowElement',
							name: null,
							attributes: [],
							children: result.children,
						});
					}
				})
				.catch((error) => {
					console.error(
						'Error reading snippet file:',
						`\n\nSnippet at: ${file.path}:${node.position?.start?.line}:${node.position?.start?.column}`,
						`\nFile path: ${filePath}`,
						`\nError: ${error instanceof Error ? error.message : String(error)}`
					);
				});

			queue.push(promise);
		});

		await Promise.all(queue);
	};
}
