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
