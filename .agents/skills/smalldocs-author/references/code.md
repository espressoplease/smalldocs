# Code

Use ordinary fenced code blocks with a language identifier.

````md
```javascript
export function total(values) {
  return values.reduce((sum, value) => sum + value, 0);
}
```
````

SmallDocs adds syntax highlighting when the language is supported. The reader can expand a code block into a focused view with line numbers, wrapping, copying, and structural folding.

## Writing a walkthrough

Explain the code in the surrounding Markdown and keep the source intact:

````md
## Request path

The handler validates input before calling the storage boundary.

```javascript
export async function save(request) {
  const input = validate(request.body);
  return repository.insert(input);
}
```

The validation result, rather than the original request body, crosses into the repository.
````

Do not reproduce comments, editing controls, or host application UI in the Markdown. Those are renderer concerns.
