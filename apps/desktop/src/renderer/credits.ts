/** Licence notices that have to travel with the software, shown in the About dialog. */

/** WordNet 3.0 licence text (Princeton University), reproduced as its terms require. */
export const WORDNET_NOTICE = "WordNet Release 3.0\n\nThis software and database is being provided to you, the LICENSEE, by\nPrinceton University under the following license.  By obtaining, using\nand/or copying this software and database, you agree that you have\nread, understood, and will comply with these terms and conditions.:\n\nPermission to use, copy, modify and distribute this software and\ndatabase and its documentation for any purpose and without fee or\nroyalty is hereby granted, provided that you agree to comply with\nthe following copyright notice and statements, including the disclaimer,\nand that the same appear on ALL copies of the software, database and\ndocumentation, including modifications that you make for internal\nuse or for distribution.\n\nWordNet 3.0 Copyright 2006 by Princeton University.  All rights reserved.\n\nTHIS SOFTWARE AND DATABASE IS PROVIDED \"AS IS\" AND PRINCETON\nUNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR\nIMPLIED.  BY WAY OF EXAMPLE, BUT NOT LIMITATION, PRINCETON\nUNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES OF MERCHANT-\nABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE USE\nOF THE LICENSED SOFTWARE, DATABASE OR DOCUMENTATION WILL NOT\nINFRINGE ANY THIRD PARTY PATENTS, COPYRIGHTS, TRADEMARKS OR\nOTHER RIGHTS.\n\nThe name of Princeton University or Princeton may not be used in\nadvertising or publicity pertaining to distribution of the software\nand/or database.  Title to copyright in this software, database and\nany associated documentation shall at all times remain with\nPrinceton University and LICENSEE agrees to preserve same.";

export interface Credit {
  name: string;
  by: string;
  what: string;
  licence: string;
  url: string;
}

/** The synonyms in the editor's right-click menu come from these two sources. */
export const THESAURUS_CREDITS: Credit[] = [
  { name: 'WordNet 3.0', by: 'Princeton University', what: 'Synonyms grouped by meaning, commonest meaning first.', licence: 'WordNet License', url: 'https://wordnet.princeton.edu' },
  { name: 'Moby Thesaurus II', by: 'Grady Ward', what: 'A large word list that fills out and ranks the suggestions.', licence: 'Public domain', url: 'https://www.gutenberg.org/ebooks/3202' },
];

/** Other open-source parts people ask about. */
export const OTHER_CREDITS: Credit[] = [
  { name: 'CodeMirror 6', by: 'Marijn Haverbeke and contributors', what: 'The text editor.', licence: 'MIT', url: 'https://codemirror.net' },
  { name: 'Preact', by: 'Jason Miller and contributors', what: 'The interface.', licence: 'MIT', url: 'https://preactjs.com' },
  { name: 'Lucide', by: 'Lucide Contributors', what: 'Icons.', licence: 'ISC', url: 'https://lucide.dev' },
  { name: 'Libertinus Serif', by: 'The Libertinus Project (a continuation of Linux Libertine)', what: 'The reading font.', licence: 'SIL Open Font License 1.1', url: 'https://github.com/alerque/libertinus' },
];
