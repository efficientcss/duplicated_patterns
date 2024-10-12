#!/usr/bin/env node

import fs from 'fs';
import postcss from 'postcss';
import nested from 'postcss-nested';
import { resolve, relative } from 'path';
import configLang from "./lib/configLang.js";
import ecssmessages from "./lib/messages.js";

const { lang } = configLang;
const messages = ecssmessages;
const chosenLang = () => {
	let messageLang;
	const osLang = Intl.DateTimeFormat().resolvedOptions().locale;

	if(lang == "auto" && (osLang.includes("en-") || osLang.includes("fr-"))){
		messageLang = osLang;
	} else if(lang == "fr" || lang == "en") {
		messageLang = lang;
	} else {
		messageLang = "en";
	}
	return messageLang.split("-")[0];
}

const printMessage = (keywordId) => {
	return messages[keywordId][chosenLang()]
}

// Function to compare selectors with context (top-level or nested rules)
function compareSelectorsWithContext(block1, block2) {
	// Compare top-level rules only with top-level rules
	if (!block1.isNested && !block2.isNested) {
		return true;
	}

	// Compare nested rules only if they share the same parent context
	if (block1.isNested && block2.isNested) {
		const sameContext = block1.parentSelectors.length === block2.parentSelectors.length &&
			block1.parentSelectors.every((sel, index) => sel === block2.parentSelectors[index]);
		return sameContext;
	}

	// If one is nested and the other is not, they cannot be compared
	return false;
}

// Function to find common declarations across CSS blocks
function findCommonDeclarations(allBlocks, minSetSize) {
	const commonSets = [];

	allBlocks.forEach((block, index) => {
		allBlocks.forEach((otherBlock, otherIndex) => {
			if (index !== otherIndex && compareSelectorsWithContext(block, otherBlock)) {
				const intersection = [...block.declarations].filter(x => otherBlock.declarations.has(x));

				if (intersection.length >= minSetSize) {
					let foundSet = commonSets.find(set => 
						(set.selectors.some(sel => sel.selector === block.selector) || 
							set.selectors.some(sel => sel.selector === otherBlock.selector)) &&
						intersection.every(decl => set.declarations.has(decl)));

					if (foundSet) {
						if (!foundSet.selectors.some(sel => sel.selector === block.selector && sel.line === block.line)) {
							foundSet.selectors.push({ selector: block.selector, file: block.file, line: block.line });
						}
						if (!foundSet.selectors.some(sel => sel.selector === otherBlock.selector && sel.line === otherBlock.line)) {
							foundSet.selectors.push({ selector: otherBlock.selector, file: otherBlock.file, line: otherBlock.line });
						}
					} else {
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

	return commonSets.filter(set => set.selectors.length >= 2);
}

// Function to aggregate all declarations from the provided CSS files
async function aggregateDeclarations(files) {
	const allBlocks = [];
	const originalLines = [];

	for (const file of files) {
		const css = fs.readFileSync(file, 'utf8');

		// Deal with nested selectors
		// Keep original nested selector lines
		const rawCss = postcss.parse(css, { from: file });
		rawCss.walkRules(rule => {
			originalLines.push(rule.source.start.line);
		});

		// Flatten nested blocks
		const processedCss = await postcss([nested]).process(css, { from: file });
		const parsedCss = postcss.parse(processedCss.css, { from: file });

		// Create index to match flattened lines back to the original ones
		let ruleIndex = 0;
		parsedCss.walkRules(rule => {
			const declarations = new Set();
			rule.walkDecls(decl => declarations.add(`${decl.prop}: ${decl.value}`));
			allBlocks.push({ 
				declarations, 
				selector: rule.selector, 
				file: parsedCss.source.input.file, 
				line: originalLines[ruleIndex]
			});
			ruleIndex += 1;
		});
	}

	return allBlocks;
}

const args = process.argv.slice(2);
const minSetSize = parseInt(args.find(arg => !isNaN(parseInt(arg, 10))), 10) || 3;
const cssFilePaths = args.filter(arg => isNaN(parseInt(arg, 10))).map(file => resolve(file));

if (cssFilePaths.length === 0) {
	console.error(printMessage("no-path-error"));
	process.exit(1);
}

(async () => {
	const allBlocks = await aggregateDeclarations(cssFilePaths);
	const commonDeclarations = findCommonDeclarations(allBlocks, minSetSize);

	if (commonDeclarations.length > 0) {
		console.log(printMessage("duplicated-pattern"));
		commonDeclarations.forEach((set, index) => {
			const uniqueSelectors = [...new Set(set.selectors.map(sel => sel.selector))].join(', ');
			console.log(`${uniqueSelectors} ${printMessage("share")} ${set.declarations.size} ${printMessage("rules")}.`);
			set.declarations.forEach(decl => console.log(`  ${decl}`));
			set.selectors.forEach(sel => {
				const relativePath = relative(process.cwd(), sel.file);
				console.log(`${sel.selector} -> ${relativePath}:${sel.line}`);
			});
			console.log();
		});
	} else {
		console.log(printMessage("no-duplication-found"));
	}
})();
