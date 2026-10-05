# Writing rules

Apply these rules to agent instructions, documentation, comments, and replies.
Use the user's language in replies. Keep each existing document's language.
ASD-STE100 governs English. For Chinese, apply the same clarity rules without English word counts.

## Sentences

- Give one instruction per sentence.
- Limit each English instruction to 20 words.
- Limit each English description to 25 words.
- Use active voice in instructions.
- Name the actor in descriptions when the source identifies the actor.
- Use imperative verbs for steps.
- Use simple present, past, or future tense.
- Keep a compound tense only when a simpler tense changes the meaning. State the exception.
- Place each condition before its action.
- Keep the subject, verb, and necessary articles.
- Do not use semicolons or phrasal verbs.
- Limit each noun cluster to three words.

## Words and structure

- Use one term for each concept. Keep its meaning and part of speech consistent.
- Preserve identifiers, commands, paths, API names, and locale keys.
- Define necessary technical terms at first use.
- Use an action verb instead of a noun for an action.
- Delete filler, slogans, and unsupported quality claims.
- Keep one topic in each paragraph. Use at most six sentences per paragraph.
- Use lists for three or more steps or conditions.
- Preserve facts, limits, exceptions, warnings, and uncertainty.
- Do not change "may fail" to "fails".

## Project terms

| Term | Meaning |
| --- | --- |
| DSH | DeepSeek Harness, the host application. |
| skill | A capability that a `SKILL.md` file defines. |
| hook | A declared action for a lifecycle event. |
| Git source | A Git repository that supplies managed skills. |
| project override | A skill setting that applies to one project `cwd`. |

## Before delivery

- Lead with the result. Include the checks and any unresolved limits.
- Use a table for comparisons. Use a diagram when relationships need it.
- Check sentence lengths, links, and consistent terms.
- Check the final text against the original meaning.
- Treat automated checks as partial evidence.
- Do not claim full ASD-STE100 compliance without a review against the official rules and dictionary.

## References

These project rules apply strict structural constraints from [ASD-STE100](https://www.asd-ste100.org/).
The [Karpathy reference](https://x.com/karpathy/status/2105819303471976479) motivates clear language and task-appropriate output formats.
