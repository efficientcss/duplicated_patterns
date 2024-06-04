#!/usr/bin/env node

import fs from 'fs';
import postcss from 'postcss';
import { resolve } from 'path';

function findCommonDeclarations(allBlocks, minSetSize) {
	const commonSets = [];

	// Compare each block with every other to find common declarations
	allBlocks.forEach((block, index) => {
		allBlocks.forEach((otherBlock, otherIndex) => {
			if (index !== otherIndex) {
				const intersection = [...block.declarations].filter(x => otherBlock.declarations.has(x));

				if (intersection.length >= minSetSize) {
					// Check if a common set already exists that includes either block or otherBlock
					let foundSet = commonSets.find(set => 
						(set.selectors.some(sel => sel.selector === block.selector) || 
						 set.selectors.some(sel => sel.selector === otherBlock.selector)) &&
						intersection.every(decl => set.declarations.has(decl)));

					if (foundSet) {
						// Avoid adding the same block multiple times
						if (!foundSet.selectors.some(sel => sel.selector === block.selector && sel.line === block.line)) {
							foundSet.selectors.push({ selector: block.selector, file: block.file, line: block.line });
						}
						if (!foundSet.selectors.some(sel => sel.selector === otherBlock.selector && sel.line === otherBlock.line)) {
							foundSet.selectors.push({ selector: otherBlock.selector, file: otherBlock.file, line: otherBlock.line });
						}
					} else {
						// Create a new set with the intersection of declarations
						commonSets.push({
							declarations: new Set(intersection),
							selectors: [
								{ selector: block.selector, file: block.file, line: block.line },
								{ selector: otherBlock.selector, file: otherBlock.file, line: otherBlock.line }
							]
						});
					}
				}
			}
		});
	});

	// Eliminate sets that don't meet the criteria
	return commonSets.filter(set => set.selectors.length >= 2);
}

function aggregateDeclarations(files) {
	const allBlocks = [];

	files.forEach(file => {
		const css = fs.readFileSync(file, 'utf8');
		const parsedCss = postcss.parse(css, { from: file });

		parsedCss.walkRules(rule => {
			const declarations = new Set();
			rule.walkDecls(decl => declarations.add(`${decl.prop}: ${decl.value}`));
			allBlocks.push({ 
				declarations, 
				selector: rule.selector, 
				file: parsedCss.source.input.file, 
				line: rule.source.start.line 
			});
		});
	});

	return allBlocks;
}

// Process command line arguments
const args = process.argv.slice(2);
const minSetSize = parseInt(args.find(arg => !isNaN(parseInt(arg, 10))), 10) || 3;
const cssFilePaths = args.filter(arg => isNaN(parseInt(arg, 10))).map(file => resolve(file));

if (cssFilePaths.length === 0) {
	console.error('Please provide at least one CSS file path.');
	process.exit(1);
}

const allBlocks = aggregateDeclarations(cssFilePaths);
const commonDeclarations = findCommonDeclarations(allBlocks, minSetSize);

if (commonDeclarations.length > 0) {
	console.log("Duplicated patterns:");
	commonDeclarations.forEach((set, index) => {
		const uniqueSelectors = [...new Set(set.selectors.map(sel => sel.selector))].join(', ');
		console.log(`${uniqueSelectors} share these ${set.declarations.size} rules:`);
		set.declarations.forEach(decl => console.log(`  ${decl}`));
		set.selectors.forEach(sel => {
			console.log(`See ${sel.selector} in ${sel.file}:${sel.line}`);
		});
		console.log();
	});
} else {
	console.log("No common declaration sets found that meet the criteria.");
}
