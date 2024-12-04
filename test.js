import path from 'node:path';
import fs from 'node:fs';
import tap from 'tap';
import remark from 'remark';
import remarkMdx from 'remark-mdx';
import {mdxSnippet} from './index.js';

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

// Create some test snippet files
const snippets = {
	'simple.mdx': '# Hello Snippet\n\nThis is a simple snippet.',
	'code.mdx': 'function hello() {\n  console.log("World");\n}',
	'nested.mdx': '## Nested Heading\n\n- List item 1\n- List item 2',
};

// Utility to create a temporary snippets directory for testing
function setupTempSnippetsDir() {
	const tempDir = path.join(process.cwd(), '_test_snippets');

	// Ensure the directory exists
	if (!fs.existsSync(tempDir)) {
		fs.mkdirSync(tempDir);
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
			fs.rmdirSync(tempDir);
		},
	};
}

tap.test('mdxSnippet plugin', (t) => {
	// Setup temporary snippets directory
	const {dir: snippetsDir, cleanup} = setupTempSnippetsDir();

	t.teardown(cleanup);

	t.test('Basic snippet inclusion', (st) => {
		const mdx = `
# Test Document

<Snippet file="simple.mdx" />
`;
		const processor = remark().use(remarkMdx).use(mdxSnippet, {snippetsDir});

		const result = processor.processSync(mdx).toString();

		st.match(result, /# Hello Snippet/, 'Should include snippet content');
		st.match(
			result,
			/This is a simple snippet\./,
			'Should include full snippet'
		);
		st.end();
	});

	t.test('Custom element and file attribute names', (st) => {
		const mdx = `
	# Test Document

	<CodeSnippet source="simple.mdx" />
	`;
		const processor = remark().use(remarkMdx).use(mdxSnippet, {
			snippetsDir,
			elementName: 'CodeSnippet',
			fileAttribute: 'source',
		});

		const result = processor.processSync(mdx).toString();

		st.match(result, /# Hello Snippet/, 'Should work with custom element name');
		st.end();
	});

	t.test('Error handling - missing file attribute', (st) => {
		const mdx = `
	# Test Document

	<Snippet />
	`;
		const consoleWarnSpy = st.capture(console, 'warn');

		const processor = remark().use(remarkMdx).use(mdxSnippet, {snippetsDir});

		st.doesNotThrow(() => {
			processor.processSync(mdx);
		}, 'Should not throw on missing file attribute');

		st.match(
			consoleWarnSpy.calls[0][0],
			/Snippet tag missing required "file" attribute/,
			'Should log warning for missing file attribute'
		);
		st.end();
	});

	t.test('Error handling - non-existent file', (st) => {
		const mdx = `
	# Test Document

	<Snippet file="non-existent.mdx" />
	`;
		const consoleErrorSpy = st.capture(console, 'error');

		const processor = remark().use(remarkMdx).use(mdxSnippet, {snippetsDir});

		st.doesNotThrow(() => {
			processor.processSync(mdx);
		}, 'Should not throw on non-existent file');

		st.match(
			consoleErrorSpy.calls[0][0],
			/Error reading snippet file/,
			'Should log error for non-existent file'
		);
		st.end();
	});

	t.test('Multiple snippet inclusions', (st) => {
		const mdx = `
	# Test Document

	<Snippet file="simple.mdx" />

	Some content

	<Snippet file="code.mdx" />
	`;
		const processor = remark().use(remarkMdx).use(mdxSnippet, {snippetsDir});

		const result = processor.processSync(mdx).toString();

		st.match(result, /# Hello Snippet/, 'Should include first snippet');
		st.match(result, /function hello\(\)/, 'Should include second snippet');
		st.end();
	});

	// Nested processing test
	t.test('Nested snippet processing', (st) => {
		const mdx = `
	# Test Document

	<Snippet file="nested.mdx" />
	`;
		const processor = remark().use(remarkMdx).use(mdxSnippet, {snippetsDir});

		const result = processor.processSync(mdx).toString();

		st.match(result, /## Nested Heading/, 'Should preserve nested structure');
		st.match(result, /- List item 1/, 'Should include list items');
		st.end();
	});

	t.end();
});
