.PHONY: test check

test:
	node --test test/*.test.mjs

check:
	node --check src/cli.mjs

