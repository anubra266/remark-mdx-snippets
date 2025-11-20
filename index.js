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
 * Fetch content from a remote URL
 * @param {string} url - The URL to fetch content from
 * @returns {Promise<{value: string, path: string}>}
 */
async function fetchRemoteContent(url) {
	try {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}
		const content = await response.text();
		return {value: content, path: url};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Failed to fetch remote content from ${url}: ${errorMessage}`
		);
	}
}

/**
 * Get file extension from URL or file path
 * @param {string} filePath - The file path or URL
 * @returns {string} - The file extension (without dot)
 */
function getFileExtension(filePath) {
	const lastDot = filePath.lastIndexOf('.');
	const lastSlash = Math.max(
		filePath.lastIndexOf('/'),
		filePath.lastIndexOf('\\')
	);

	// If there's no dot, or the dot is before the last slash (part of directory name)
	if (lastDot === -1 || lastDot < lastSlash) {
		return '';
	}

	return filePath.substring(lastDot + 1).toLowerCase();
}

/**
 * Check if file extension should be processed as markdown content
 * @param {string} extension - File extension
 * @returns {boolean}
 */
function isMarkdownExtension(extension) {
	return extension === 'md' || extension === 'mdx';
}

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

			const isRemoteFile =
				fileAttr.value.startsWith('https://') ||
				fileAttr.value.startsWith('http://');

			// Extract lang and meta attributes for code blocks
			// @ts-ignore
			const langAttr = node.attributes.find(
				(/** @type {any} */ attr) => attr.name === 'lang'
			);
			// @ts-ignore
			const metaAttr = node.attributes.find(
				(/** @type {any} */ attr) => attr.name === 'meta'
			);

			const lang =
				langAttr && typeof langAttr.value === 'string' ? langAttr.value : null;
			const meta =
				metaAttr && typeof metaAttr.value === 'string' ? metaAttr.value : null;

			let contentPromise;
			let filePath;

			if (isRemoteFile) {
				// Handle remote files
				const url = fileAttr.value; // Use URL directly
				filePath = url;
				contentPromise = fetchRemoteContent(url);
			} else {
				// Handle local files
				filePath = path.join(snippetsDir, fileAttr.value);

				// Add dependency tracking for HMR support
				// @ts-ignore
				const compiler = /** @type {any} */ (file.data._compiler);
				if (compiler && typeof compiler.addDependency === 'function') {
					compiler.addDependency(filePath);
				}

				contentPromise = read(filePath, 'utf8');
			}

			const promise = contentPromise
				.then((snippetFile) => {
					// Determine the file extension to decide processing method
					// We already verified fileAttr.value is a string above
					const fileValue = /** @type {string} */ (fileAttr.value);
					const sourceFile = fileValue; // Use as-is for both remote and local files
					const extension = getFileExtension(sourceFile);

					if (isMarkdownExtension(extension)) {
						// Process as markdown content
						if (isRemoteFile) {
							// For remote markdown/MDX files, use a simpler processor that doesn't cause MDX conflicts
							const content =
								typeof snippetFile === 'string'
									? snippetFile
									: snippetFile.value || snippetFile;
							// Try GFM first for full HTML/table support, fallback to basic if it fails
							const gfmProcessor = (unified ?? remark())
								.use(remarkGfm)
								.use(remarkStringify)
								.use(mdxSnippet, {
									snippetsDir,
									fileAttribute,
									elementName,
									processor: unified,
								});

							const basicProcessor = (unified ?? remark())
								.use(remarkStringify)
								.use(mdxSnippet, {
									snippetsDir,
									fileAttribute,
									elementName,
									processor: unified,
								});

							try {
								// First attempt: try with GFM for full feature support
								// @ts-ignore
								const vfile = new VFile({value: content, path: sourceFile});
								const ast = gfmProcessor().parse(vfile);
								return gfmProcessor().run(ast, vfile);
							} catch (gfmError) {
								// Fallback: use basic processing if GFM fails
								const errorMessage =
									gfmError instanceof Error
										? gfmError.message
										: String(gfmError);
								console.warn(
									'GFM processing failed, falling back to basic markdown:',
									errorMessage
								);

								const ast = basicProcessor().parse(content);
								const fileObj = {value: content, path: sourceFile, data: {}};
								return basicProcessor().run(ast, fileObj);
							}
						} else {
							// For local files, use the full processor including MDX
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

							const ast = snippetProcessor().parse(snippetFile);
							return snippetProcessor().run(ast, snippetFile);
						}
					} else {
						// Create a code block for non-markdown files
						const codeBlockNode = {
							type: 'code',
							lang: lang || extension || null,
							meta: meta || null,
							value: snippetFile.value || snippetFile,
						};

						// Return a result with the code block as a child
						return {
							type: 'root',
							children: [codeBlockNode],
						};
					}
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
					// We already verified fileAttr.value is a string above
					const fileValue = /** @type {string} */ (fileAttr.value);
					const sourcePath = isRemoteFile
						? fileValue // Use URL directly for display
						: path.join(snippetsDir, fileValue);

					console.error(
						'Error reading snippet file:',
						`\n\nSnippet at: ${file.path}:${node.position?.start?.line}:${node.position?.start?.column}`,
						`\n${isRemoteFile ? 'Remote URL' : 'File path'}: ${sourcePath}`,
						`\nError: ${error instanceof Error ? error.message : String(error)}`
					);
				});

			queue.push(promise);
		});

		await Promise.all(queue);
	};
}
