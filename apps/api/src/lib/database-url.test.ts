import { describe, expect, it } from 'vitest'
import { resolveDatabaseUrl, withDatabase } from './database-url.js'

describe('one MongoDB setting', () => {
  it('puts the platform database on the cluster string, keeping its options', () => {
    expect(withDatabase('mongodb://mongo:27017/?replicaSet=rs0&directConnection=true', 'csai'))
      .toBe('mongodb://mongo:27017/csai?replicaSet=rs0&directConnection=true')
    expect(withDatabase('mongodb+srv://u:p%40ss@cluster0.ab1cd.mongodb.net/?retryWrites=true&w=majority', 'csai'))
      .toBe('mongodb+srv://u:p%40ss@cluster0.ab1cd.mongodb.net/csai?retryWrites=true&w=majority')
    expect(withDatabase('mongodb+srv://u:p@cluster0.ab1cd.mongodb.net', 'csai'))
      .toBe('mongodb+srv://u:p@cluster0.ab1cd.mongodb.net/csai')
    expect(withDatabase('mongodb://a:1,b:2/other?replicaSet=rs0', 'csai'))
      .toBe('mongodb://a:1,b:2/csai?replicaSet=rs0')
  })

  it('an explicit DATABASE_URL wins; otherwise MONGODB_URI decides', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: 'mongodb://x/db', MONGODB_URI: 'mongodb://y/' })).toBe('mongodb://x/db')
    expect(resolveDatabaseUrl({ MONGODB_URI: 'mongodb://y:27017/?replicaSet=rs0' })).toBe('mongodb://y:27017/csai?replicaSet=rs0')
    expect(resolveDatabaseUrl({ DATABASE_URL: '  ', MONGODB_URI: '' })).toBeUndefined()
  })
})
