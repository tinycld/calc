import { describe, expect, it } from 'vitest'
import { isCsvLike } from '../tinycld/calc/screens/index'

function fakeFile(name: string, type = ''): File {
    return new File([''], name, { type })
}

describe('calc isCsvLike', () => {
    it('matches .csv by extension', () => {
        expect(isCsvLike(fakeFile('Budget.csv'))).toBe(true)
        expect(isCsvLike(fakeFile('BUDGET.CSV'))).toBe(true)
    })

    it('matches .tsv and .txt by extension', () => {
        expect(isCsvLike(fakeFile('data.tsv'))).toBe(true)
        expect(isCsvLike(fakeFile('notes.txt'))).toBe(true)
    })

    it('matches by MIME type when extension is unclear', () => {
        expect(isCsvLike(fakeFile('blob', 'text/csv'))).toBe(true)
        expect(isCsvLike(fakeFile('blob', 'text/tab-separated-values'))).toBe(true)
        expect(isCsvLike(fakeFile('blob', 'text/plain'))).toBe(true)
    })

    it('rejects xlsx files', () => {
        expect(
            isCsvLike(
                fakeFile(
                    'Q3.xlsx',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                )
            )
        ).toBe(false)
        expect(isCsvLike(fakeFile('plain.xlsx'))).toBe(false)
    })

    it('rejects unrelated extensions', () => {
        expect(isCsvLike(fakeFile('photo.jpg', 'image/jpeg'))).toBe(false)
        expect(isCsvLike(fakeFile('archive.zip', 'application/zip'))).toBe(false)
    })
})
