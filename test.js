import path from 'node:path';
import fs from 'node:fs';
import tap from 'tap';
import remarkMdx from 'remark-mdx';
import remarkStringify from 'remark-stringify';
import {mdxSnippet} from './index.js';
import {unified} from 'unified';
import remarkParse from 'remark-parse';

tap.Test.prototype.capture = function (target, method) {
	const original = target[method];
	const calls = [];

	target[method] = (...args) => {
		calls.push(args);
	};

	// Restore the original method when the test ends
	this.teardown(() => {
		target[method] = original;
	});

	return {
		calls,
		restore: () => {
			target[method] = original;
		},
	};
};

async function mock(mdx, cb) {
	const processor = unified().use(remarkParse).use(remarkMdx);
	cb(processor);
	processor.use(remarkStringify);

	const tree = processor.parse(mdx);
	const transformedTree = await processor.run(tree);
	const result = processor.stringify(transformedTree);
	return result;
}

// Create some test snippet files
const snippets = {
	'simple.mdx': '# Hello Snippet\n\nThis is a simple snippet.',
	'secondary.mdx': '# Secondary Snippet\n\nThis is another simple snippet.',
	'nested.mdx': '## Nested Heading\n\n<Snippet file="child.mdx" />',
	'child.mdx': '- List item 1\n- List item 2',
	'./directory/dir.mdx':
		'# Directory Snippet\n\nThis is a snippet in a directory.',
};

// Utility to create a temporary snippets directory for testing
function setupTempSnippetsDir() {
	const tempDir = path.join(process.cwd(), '_test_snippets');

	// Ensure the directory exists
	if (!fs.existsSync(tempDir)) {
		fs.mkdirSync(tempDir);
		fs.mkdirSync(path.join(tempDir, 'directory'), {recursive: true});
	}

	Object.entries(snippets).forEach(([filename, content]) => {
		fs.writeFileSync(path.join(tempDir, filename), content);
	});

	return {
		dir: tempDir,
		cleanup: () => {
			// Remove all files
			Object.keys(snippets).forEach((filename) => {
				fs.unlinkSync(path.join(tempDir, filename));
			});
			// Remove directory
			fs.rmdirSync(path.join(tempDir, 'directory'));
			fs.rmdirSync(tempDir);
		},
	};
}

// Mock fetch for remote file testing
function createFetchMock(responses = {}) {
	return async (url, options) => {
		if (responses[url]) {
			const response = responses[url];
			if (response.error) {
				throw new Error(response.error);
			}
			return {
				ok: response.ok !== false,
				status: response.status || 200,
				statusText: response.statusText || 'OK',
				text: async () => response.content || '',
			};
		}
		// Default 404 for unmocked URLs
		return {
			ok: false,
			status: 404,
			statusText: 'Not Found',
			text: async () => 'Not Found',
		};
	};
}

tap.test('mdxSnippet plugin', (t) => {
	// Setup temporary snippets directory
	const {dir: snippetsDir, cleanup} = setupTempSnippetsDir();

	t.teardown(cleanup);

	t.test('Basic snippet inclusion', async (st) => {
		const mdx = `
# Test Document

<Snippet file="simple.mdx" />
`;

		const result = await mock(mdx, (processor) =>
			processor.use(mdxSnippet, {snippetsDir})
		);

		st.match(result, /# Hello Snippet/, 'Should include snippet content');
		st.match(
			result,
			/This is a simple snippet\./,
			'Should include full snippet'
		);
		st.end();
	});

	t.test('Custom element and file attribute names', async (st) => {
		const mdx = `
	# Test Document

	<CodeSnippet source="simple.mdx" />
	`;

		const result = await mock(mdx, (processor) =>
			processor.use(mdxSnippet, {
				snippetsDir,
				elementName: 'CodeSnippet',
				fileAttribute: 'source',
			})
		);

		st.match(result, /# Hello Snippet/, 'Should work with custom element name');
		st.end();
	});

	t.test('Error handling - missing file attribute', async (st) => {
		const mdx = `
	# Test Document

	<Snippet />
	`;
		const consoleWarnSpy = st.capture(console, 'warn');

		try {
			await mock(mdx, (processor) => processor.use(mdxSnippet, {snippetsDir}));
			st.pass('Should not throw on missing file attribute');
		} catch (error) {
			st.fail('Should not throw on missing file attribute');
		}

		st.match(
			consoleWarnSpy.calls[0][0],
			/Snippet tag missing required "file" attribute/,
			'Should log warning for missing file attribute'
		);
		st.end();
	});

	t.test('Error handling - non-existent file', async (st) => {
		const mdx = `
	# Test Document

	<Snippet file="non-existent.mdx" />
	`;
		const consoleErrorSpy = st.capture(console, 'error');

		try {
			await mock(mdx, (processor) => processor.use(mdxSnippet, {snippetsDir}));
			st.pass('Should not throw on non-existent file');
		} catch (error) {
			st.fail('Should not throw on non-existent file');
		}

		st.match(
			consoleErrorSpy.calls[0][0],
			/Error reading snippet file/,
			'Should log error for non-existent file'
		);
		st.end();
	});

	t.test('Multiple snippet inclusions', async (st) => {
		const mdx = `
	# Test Document

	<Snippet file="simple.mdx" />

	Some content

	<Snippet file="secondary.mdx" />
	`;

		const result = await mock(mdx, (processor) =>
			processor.use(mdxSnippet, {snippetsDir})
		);

		st.match(result, /# Hello Snippet/, 'Should include first snippet');
		st.match(result, /# Secondary Snippet/, 'Should include second snippet');
		st.end();
	});

	// Nested processing test
	t.test('Nested snippet processing', async (st) => {
		const mdx = `
	# Test Document

	<Snippet file="nested.mdx" />
	`;
		const result = await mock(mdx, (processor) =>
			processor.use(mdxSnippet, {snippetsDir, processor: processor()})
		);

		st.match(result, /## Nested Heading/, 'Should preserve nested structure');
		st.match(result, /\* List item 1/, 'Should include list items');
		st.end();
	});

	t.test('Snippet in a directory', async (st) => {
		const mdx = `
# Test Document

<Snippet file="directory/dir.mdx" />
`;

		const result = await mock(mdx, (processor) =>
			processor.use(mdxSnippet, {snippetsDir})
		);

		st.match(result, /# Directory Snippet/, 'Should include snippet content');
		st.match(
			result,
			/This is a snippet in a directory\./,
			'Should include full snippet'
		);
		st.end();
	});

	t.test('Complex multiple snippets - all should be processed', async (st) => {
		const mdx = `
# Test Document

Some intro text

<Snippet file="simple.mdx" />

Middle content here

<Snippet file="secondary.mdx" />

More content

<Snippet file="directory/dir.mdx" />

Final content
`;

		const result = await mock(mdx, (processor) =>
			processor.use(mdxSnippet, {snippetsDir})
		);

		// Check that all snippets were processed
		st.match(result, /# Hello Snippet/, 'Should include first snippet');
		st.match(
			result,
			/This is a simple snippet\./,
			'Should include first snippet content'
		);
		st.match(result, /# Secondary Snippet/, 'Should include second snippet');
		st.match(
			result,
			/This is another simple snippet\./,
			'Should include second snippet content'
		);
		st.match(result, /# Directory Snippet/, 'Should include third snippet');
		st.match(
			result,
			/This is a snippet in a directory\./,
			'Should include third snippet content'
		);

		// Check that original content is preserved
		st.match(result, /Some intro text/, 'Should preserve intro text');
		st.match(result, /Middle content here/, 'Should preserve middle content');
		st.match(result, /More content/, 'Should preserve more content');
		st.match(result, /Final content/, 'Should preserve final content');

		st.end();
	});

	t.end();
});

tap.test('mdxSnippet plugin - Remote Files', (t) => {
	// Setup temporary snippets directory for mixed tests
	const {dir: snippetsDir, cleanup} = setupTempSnippetsDir();

	t.teardown(cleanup);

	t.test('Basic remote file inclusion', async (st) => {
		const mdx = `
# Test Document

<Snippet file="https://raw.githubusercontent.com/anubra266/agents/refs/heads/main/README.md" />
`;

		const result = await mock(mdx, (processor) =>
			processor.use(mdxSnippet, {snippetsDir})
		);

		// Test for specific content from the GitHub README
		st.match(
			result,
			/Build AI Agents with a.*No-Code Visual Builder.*or.*TypeScript SDK/,
			'Should include the main description from GitHub README'
		);
		st.match(
			result,
			/full 2-way sync/,
			'Should include sync description from GitHub README'
		);
		st.match(
			result,
			/A no-code, drag-and-drop canvas/,
			'Should include visual builder description'
		);
		// Should not contain the original Snippet tag if processed successfully
		st.notMatch(
			result,
			/<Snippet file=/,
			'Should replace Snippet tag with actual content'
		);
		st.end();
	});

	t.test(
		'Custom element and file attribute names with remote files',
		async (st) => {
			const originalFetch = global.fetch;
			const mockResponses = {
				'https://example.com/custom-remote.md': {
					content: '# Custom Remote\n\nCustom element test with remote file.',
				},
			};

			global.fetch = createFetchMock(mockResponses);
			st.teardown(() => {
				global.fetch = originalFetch;
			});

			const mdx = `
# Test Document

<CodeSnippet source="https://example.com/custom-remote.md" />
`;

			const result = await mock(mdx, (processor) =>
				processor.use(mdxSnippet, {
					snippetsDir,
					elementName: 'CodeSnippet',
					fileAttribute: 'source',
				})
			);

			st.match(
				result,
				/# Custom Remote/,
				'Should work with custom element name and remote URL'
			);
			st.end();
		}
	);

	t.test('Error handling - HTTP error response', async (st) => {
		const originalFetch = global.fetch;
		const mockResponses = {
			'https://example.com/not-found.md': {
				ok: false,
				status: 404,
				statusText: 'Not Found',
			},
		};

		global.fetch = createFetchMock(mockResponses);
		const consoleErrorSpy = st.capture(console, 'error');
		st.teardown(() => {
			global.fetch = originalFetch;
		});

		const mdx = `
# Test Document

<Snippet file="https://example.com/not-found.md" />
`;

		try {
			await mock(mdx, (processor) => processor.use(mdxSnippet, {snippetsDir}));
			st.pass('Should not throw on HTTP error');
		} catch (error) {
			st.fail('Should not throw on HTTP error');
		}

		st.match(
			consoleErrorSpy.calls[0][0],
			/Error reading snippet file/,
			'Should log error for HTTP error'
		);
		st.match(
			consoleErrorSpy.calls[0][2],
			/Remote URL: https:\/\/example\.com\/not-found\.md/,
			'Should show remote URL in error message'
		);
		st.end();
	});

	t.test('Error handling - Network error', async (st) => {
		const originalFetch = global.fetch;
		const mockResponses = {
			'https://example.com/network-error.md': {
				error: 'Network timeout',
			},
		};

		global.fetch = createFetchMock(mockResponses);
		const consoleErrorSpy = st.capture(console, 'error');
		st.teardown(() => {
			global.fetch = originalFetch;
		});

		const mdx = `
# Test Document

<Snippet file="https://example.com/network-error.md" />
`;

		try {
			await mock(mdx, (processor) => processor.use(mdxSnippet, {snippetsDir}));
			st.pass('Should not throw on network error');
		} catch (error) {
			st.fail('Should not throw on network error');
		}

		st.match(
			consoleErrorSpy.calls[0][0],
			/Error reading snippet file/,
			'Should log error for network error'
		);
		// Check that the error message includes network timeout details
		// The error details are in the last parameter of console.error
		const errorCall = consoleErrorSpy.calls[0];
		const errorMessage = errorCall[errorCall.length - 1];
		st.match(
			errorMessage,
			/Network timeout/,
			'Should include network error details'
		);
		st.end();
	});

	t.test('Mixed local and remote files', async (st) => {
		const originalFetch = global.fetch;
		const mockResponses = {
			'https://example.com/mixed-test.md': {
				content: '# Mixed Test Remote\n\nThis is from a remote source.',
			},
		};

		global.fetch = createFetchMock(mockResponses);
		st.teardown(() => {
			global.fetch = originalFetch;
		});

		const mdx = `
# Test Document

Local snippet:
<Snippet file="simple.mdx" />

Remote snippet:
<Snippet file="https://example.com/mixed-test.md" />

Another local snippet:
<Snippet file="secondary.mdx" />
`;

		const result = await mock(mdx, (processor) =>
			processor.use(mdxSnippet, {snippetsDir})
		);

		// Check local files
		st.match(result, /# Hello Snippet/, 'Should include first local snippet');
		st.match(
			result,
			/# Secondary Snippet/,
			'Should include second local snippet'
		);

		// Check remote file
		st.match(result, /# Mixed Test Remote/, 'Should include remote snippet');
		st.match(
			result,
			/This is from a remote source\./,
			'Should include remote content'
		);

		// Check original content is preserved
		st.match(result, /Local snippet:/, 'Should preserve local content markers');
		st.match(
			result,
			/Remote snippet:/,
			'Should preserve remote content markers'
		);
		st.end();
	});

	t.test('Remote files with nested content', async (st) => {
		const originalFetch = global.fetch;
		const mockResponses = {
			'https://example.com/nested-remote.md': {
				content: '# Remote Parent\n\n<Snippet file="child.mdx" />',
			},
		};

		global.fetch = createFetchMock(mockResponses);
		st.teardown(() => {
			global.fetch = originalFetch;
		});

		const mdx = `
# Test Document

<Snippet file="https://example.com/nested-remote.md" />
`;

		const result = await mock(mdx, (processor) =>
			processor.use(mdxSnippet, {snippetsDir, processor: processor()})
		);

		st.match(result, /# Remote Parent/, 'Should include remote parent content');
		st.match(
			result,
			/\* List item 1/,
			'Should process nested local snippet from remote content'
		);
		st.end();
	});

	t.test('Multiple remote files', async (st) => {
		const originalFetch = global.fetch;
		const mockResponses = {
			'https://api.example.com/snippet1.md': {
				content: '# First Remote\n\nFirst remote snippet content.',
			},
			'https://cdn.example.com/snippet2.md': {
				content: '# Second Remote\n\nSecond remote snippet content.',
			},
		};

		global.fetch = createFetchMock(mockResponses);
		st.teardown(() => {
			global.fetch = originalFetch;
		});

		const mdx = `
# Test Document

<Snippet file="https://api.example.com/snippet1.md" />

Some content in between.

<Snippet file="https://cdn.example.com/snippet2.md" />
`;

		const result = await mock(mdx, (processor) =>
			processor.use(mdxSnippet, {snippetsDir})
		);

		st.match(result, /# First Remote/, 'Should include first remote snippet');
		st.match(
			result,
			/First remote snippet content\./,
			'Should include first remote content'
		);
		st.match(result, /# Second Remote/, 'Should include second remote snippet');
		st.match(
			result,
			/Second remote snippet content\./,
			'Should include second remote content'
		);
		st.match(
			result,
			/Some content in between\./,
			'Should preserve content between snippets'
		);
		st.end();
	});

	t.end();
});

tap.test('mdxSnippet plugin - File Extensions', (t) => {
	// Setup temporary snippets directory for mixed tests
	const {dir: snippetsDir, cleanup} = setupTempSnippetsDir();

	t.teardown(cleanup);

	t.test('Markdown files (.md) processed as content', async (st) => {
		const originalFetch = global.fetch;
		const mockResponses = {
			'https://example.com/content.md': {
				content: '# Markdown Content\n\nThis should be processed as markdown.',
			},
		};

		global.fetch = createFetchMock(mockResponses);
		st.teardown(() => {
			global.fetch = originalFetch;
		});

		const mdx = `
# Test Document

<Snippet file="https://example.com/content.md" />
`;

		const result = await mock(mdx, (processor) =>
			processor.use(mdxSnippet, {snippetsDir})
		);

		st.match(
			result,
			/# Markdown Content/,
			'Should process .md as markdown content'
		);
		st.match(
			result,
			/This should be processed as markdown\./,
			'Should include markdown content'
		);
		// Should NOT be a code block
		st.notMatch(result, /```/, 'Should not create code block for .md files');
		st.end();
	});

	t.test('MDX files (.mdx) processed as content', async (st) => {
		const originalFetch = global.fetch;
		const mockResponses = {
			'https://example.com/content.mdx': {
				content: '# MDX Content\n\n<div>JSX in MDX</div>\n\nRegular markdown.',
			},
		};

		global.fetch = createFetchMock(mockResponses);
		st.teardown(() => {
			global.fetch = originalFetch;
		});

		const mdx = `
# Test Document

<Snippet file="https://example.com/content.mdx" />
`;

		const result = await mock(mdx, (processor) =>
			processor.use(mdxSnippet, {snippetsDir})
		);

		st.match(
			result,
			/# MDX Content/,
			'Should process .mdx as markdown content'
		);
		st.match(result, /Regular markdown\./, 'Should include markdown content');
		// Should NOT be a code block
		st.notMatch(result, /```/, 'Should not create code block for .mdx files');
		st.end();
	});

	t.test('JavaScript files (.js) become code blocks', async (st) => {
		const originalFetch = global.fetch;
		const mockResponses = {
			'https://example.com/script.js': {
				content:
					'function hello() {\n  console.log("Hello, world!");\n}\n\nhello();',
			},
		};

		global.fetch = createFetchMock(mockResponses);
		st.teardown(() => {
			global.fetch = originalFetch;
		});

		const mdx = `
# Test Document

<Snippet file="https://example.com/script.js" />
`;

		const result = await mock(mdx, (processor) =>
			processor.use(mdxSnippet, {snippetsDir})
		);

		st.match(result, /```js/, 'Should create code block with js language');
		st.match(result, /function hello\(\)/, 'Should include JavaScript content');
		st.match(result, /console\.log/, 'Should preserve JavaScript syntax');
		st.end();
	});

	t.test('Custom lang attribute overrides file extension', async (st) => {
		const originalFetch = global.fetch;
		const mockResponses = {
			'https://example.com/script.js': {
				content: 'const greeting = "Hello, TypeScript!";',
			},
		};

		global.fetch = createFetchMock(mockResponses);
		st.teardown(() => {
			global.fetch = originalFetch;
		});

		const mdx = `
# Test Document

<Snippet file="https://example.com/script.js" lang="typescript" />
`;

		const result = await mock(mdx, (processor) =>
			processor.use(mdxSnippet, {snippetsDir})
		);

		st.match(
			result,
			/```typescript/,
			'Should use custom lang attribute instead of file extension'
		);
		st.match(result, /const greeting/, 'Should include file content');
		st.end();
	});

	t.test('Meta attribute included in code block', async (st) => {
		const originalFetch = global.fetch;
		const mockResponses = {
			'https://example.com/config.json': {
				content: '{\n  "name": "test-project",\n  "version": "1.0.0"\n}',
			},
		};

		global.fetch = createFetchMock(mockResponses);
		st.teardown(() => {
			global.fetch = originalFetch;
		});

		const mdx = `
# Test Document

<Snippet file="https://example.com/config.json" meta='title="Package Configuration"' />
`;

		const result = await mock(mdx, (processor) =>
			processor.use(mdxSnippet, {snippetsDir})
		);

		st.match(
			result,
			/```json title="Package Configuration"/,
			'Should include meta attribute in code block'
		);
		st.match(result, /"name": "test-project"/, 'Should include JSON content');
		st.end();
	});

	t.test('Files with no extension become plain code blocks', async (st) => {
		const originalFetch = global.fetch;
		const mockResponses = {
			'https://example.com/Dockerfile': {
				content: 'FROM node:18\nWORKDIR /app\nCOPY . .\nRUN npm install',
			},
		};

		global.fetch = createFetchMock(mockResponses);
		st.teardown(() => {
			global.fetch = originalFetch;
		});

		const mdx = `
# Test Document

<Snippet file="https://example.com/Dockerfile" />
`;

		const result = await mock(mdx, (processor) =>
			processor.use(mdxSnippet, {snippetsDir})
		);

		st.match(
			result,
			/```\nFROM node:18/,
			'Should create code block without language for files with no extension'
		);
		st.match(result, /WORKDIR \/app/, 'Should include file content');
		st.end();
	});

	t.test('Local files also respect extension rules', async (st) => {
		// Create a JavaScript test file
		const tempJsFile = path.join(snippetsDir, 'test-script.js');
		fs.writeFileSync(tempJsFile, 'console.log("Local JavaScript file");');

		st.teardown(() => {
			if (fs.existsSync(tempJsFile)) {
				fs.unlinkSync(tempJsFile);
			}
		});

		const mdx = `
# Test Document

<Snippet file="test-script.js" />
`;

		const result = await mock(mdx, (processor) =>
			processor.use(mdxSnippet, {snippetsDir})
		);

		st.match(
			result,
			/```js/,
			'Should create code block for local JavaScript file'
		);
		st.match(result, /console\.log/, 'Should include JavaScript content');
		st.end();
	});

	t.test('Mixed markdown and code files', async (st) => {
		const originalFetch = global.fetch;
		const mockResponses = {
			'https://example.com/readme.md': {
				content: '# API Documentation\n\nThis is markdown content.',
			},
			'https://example.com/example.py': {
				content:
					'def greet(name):\n    return f"Hello, {name}!"\n\nprint(greet("World"))',
			},
		};

		global.fetch = createFetchMock(mockResponses);
		st.teardown(() => {
			global.fetch = originalFetch;
		});

		const mdx = `
# Test Document

Documentation:
<Snippet file="https://example.com/readme.md" />

Example code:
<Snippet file="https://example.com/example.py" />
`;

		const result = await mock(mdx, (processor) =>
			processor.use(mdxSnippet, {snippetsDir})
		);

		// Check markdown content
		st.match(
			result,
			/# API Documentation/,
			'Should process markdown as content'
		);
		st.match(
			result,
			/This is markdown content\./,
			'Should include markdown text'
		);

		// Check Python code block
		st.match(result, /```py/, 'Should create Python code block');
		st.match(result, /def greet\(name\):/, 'Should include Python code');

		// Check structure
		st.match(
			result,
			/Documentation:/,
			'Should preserve content between snippets'
		);
		st.match(result, /Example code:/, 'Should preserve labels');
		st.end();
	});

	t.test('Both lang and meta attributes together', async (st) => {
		const originalFetch = global.fetch;
		const mockResponses = {
			'https://example.com/snippet.txt': {
				content:
					'export default function Component() {\n  return <div>Hello</div>;\n}',
			},
		};

		global.fetch = createFetchMock(mockResponses);
		st.teardown(() => {
			global.fetch = originalFetch;
		});

		const mdx = `
# Test Document

<Snippet file="https://example.com/snippet.txt" lang="jsx" meta='title="React Component" showLineNumbers' />
`;

		const result = await mock(mdx, (processor) =>
			processor.use(mdxSnippet, {snippetsDir})
		);

		st.match(
			result,
			/```jsx title="React Component" showLineNumbers/,
			'Should include both lang and meta attributes'
		);
		st.match(
			result,
			/export default function Component/,
			'Should include file content'
		);
		st.end();
	});

	t.end();
});
