import ts from 'typescript-eslint';
export default ts.config({ ignores: ['dist/**'] }, ...ts.configs.recommended);
