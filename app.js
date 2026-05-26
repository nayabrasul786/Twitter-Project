const express = require('express')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const path = require('path')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const app = express()

app.use(express.json())

const dbPath = path.join(__dirname, 'twitterClone.db')

let db = null

// ------------------ DATABASE & SERVER ------------------

const initializeDbServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })

    const PORT = process.env.PORT || 3000

    app.listen(PORT, () => {
      console.log(`Server Running at http://localhost:${PORT}/`)
    })
  } catch (e) {
    console.log(`DB Error: ${e.message}`)
    process.exit(1)
  }
}

initializeDbServer()

// ROOT ROUTE

app.get('/', (request, response) => {
  response.send('Twitter Clone API Running')
})

// ------------------ JWT AUTHENTICATION ------------------

const authenticationToken = (request, response, next) => {
  let jwtToken

  const authHeader = request.headers['authorization']

  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }

  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'SECRET_KEY', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.userId = payload.userId
        request.username = payload.username
        next()
      }
    })
  }
}

// ------------------ VERIFY TWEET ACCESS ------------------

const verifyTweetAccess = async (request, response, next) => {
  const {tweetId} = request.params
  const {userId} = request

  const getTweetQuery = `
    SELECT *
    FROM tweet
    INNER JOIN follower
      ON tweet.user_id = follower.following_user_id
    WHERE
      tweet.tweet_id = ${tweetId}
      AND follower.follower_user_id = ${userId};
  `

  const tweet = await db.get(getTweetQuery)

  if (tweet === undefined) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    next()
  }
}

// ------------------ API 1 REGISTER ------------------

app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body

  const checkUserQuery = `
    SELECT *
    FROM user
    WHERE username = '${username}';
  `

  const dbUser = await db.get(checkUserQuery)

  if (dbUser !== undefined) {
    response.status(400)
    response.send('User already exists')
  } else if (password.length < 6) {
    response.status(400)
    response.send('Password is too short')
  } else {
    const hashedPassword = await bcrypt.hash(password, 10)

    const createUserQuery = `
      INSERT INTO user (
        name,
        username,
        password,
        gender
      )
      VALUES (
        '${name}',
        '${username}',
        '${hashedPassword}',
        '${gender}'
      );
    `

    await db.run(createUserQuery)

    response.send('User created successfully')
  }
})

// ------------------ API 2 LOGIN ------------------

app.post('/login/', async (request, response) => {
  const {username, password} = request.body

  const getUserQuery = `
    SELECT *
    FROM user
    WHERE username = '${username}';
  `

  const dbUser = await db.get(getUserQuery)

  if (dbUser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password)

    if (isPasswordMatched) {
      const payload = {
        username: username,
        userId: dbUser.user_id,
      }

      const jwtToken = jwt.sign(payload, 'SECRET_KEY')

      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

// ------------------ API 3 USER FEED ------------------

app.get(
  '/user/tweets/feed/',
  authenticationToken,
  async (request, response) => {
    const {userId} = request

    const getFeedQuery = `
      SELECT
        user.username,
        tweet.tweet,
        tweet.date_time AS dateTime
      FROM follower
      INNER JOIN tweet
        ON follower.following_user_id = tweet.user_id
      INNER JOIN user
        ON user.user_id = tweet.user_id
      WHERE follower.follower_user_id = ${userId}
      ORDER BY tweet.date_time DESC
      LIMIT 4;
    `

    const tweets = await db.all(getFeedQuery)

    response.send(tweets)
  },
)

// ------------------ API 4 FOLLOWING ------------------

app.get('/user/following/', authenticationToken, async (request, response) => {
  const {userId} = request

  const getFollowingQuery = `
      SELECT user.name
      FROM follower
      INNER JOIN user
        ON follower.following_user_id = user.user_id
      WHERE follower.follower_user_id = ${userId};
    `

  const followingUsers = await db.all(getFollowingQuery)

  response.send(followingUsers)
})

// ------------------ API 5 FOLLOWERS ------------------

app.get('/user/followers/', authenticationToken, async (request, response) => {
  const {userId} = request

  const getFollowersQuery = `
      SELECT user.name
      FROM follower
      INNER JOIN user
        ON follower.follower_user_id = user.user_id
      WHERE follower.following_user_id = ${userId};
    `

  const followers = await db.all(getFollowersQuery)

  response.send(followers)
})

// ------------------ API 6 TWEET DETAILS ------------------

app.get(
  '/tweets/:tweetId/',
  authenticationToken,
  verifyTweetAccess,
  async (request, response) => {
    const {tweetId} = request.params

    const getTweetQuery = `
      SELECT
        tweet,
        (
          SELECT COUNT(*)
          FROM like
          WHERE tweet_id = ${tweetId}
        ) AS likes,
        (
          SELECT COUNT(*)
          FROM reply
          WHERE tweet_id = ${tweetId}
        ) AS replies,
        date_time AS dateTime
      FROM tweet
      WHERE tweet_id = ${tweetId};
    `

    const tweet = await db.get(getTweetQuery)

    response.send(tweet)
  },
)

// ------------------ API 7 TWEET LIKES ------------------

app.get(
  '/tweets/:tweetId/likes/',
  authenticationToken,
  verifyTweetAccess,
  async (request, response) => {
    const {tweetId} = request.params

    const getLikesQuery = `
      SELECT user.username
      FROM like
      INNER JOIN user
        ON like.user_id = user.user_id
      WHERE like.tweet_id = ${tweetId};
    `

    const likedUsers = await db.all(getLikesQuery)

    response.send({
      likes: likedUsers.map(each => each.username),
    })
  },
)

// ------------------ API 8 TWEET REPLIES ------------------

app.get(
  '/tweets/:tweetId/replies/',
  authenticationToken,
  verifyTweetAccess,
  async (request, response) => {
    const {tweetId} = request.params

    const getRepliesQuery = `
      SELECT
        user.name,
        reply.reply
      FROM reply
      INNER JOIN user
        ON reply.user_id = user.user_id
      WHERE reply.tweet_id = ${tweetId};
    `

    const replies = await db.all(getRepliesQuery)

    response.send({
      replies: replies,
    })
  },
)

// ------------------ API 9 USER TWEETS ------------------

app.get('/user/tweets/', authenticationToken, async (request, response) => {
  const {userId} = request

  const getUserTweetsQuery = `
      SELECT
        tweet.tweet,
        COUNT(DISTINCT like.like_id) AS likes,
        COUNT(DISTINCT reply.reply_id) AS replies,
        tweet.date_time AS dateTime
      FROM tweet
      LEFT JOIN like
        ON tweet.tweet_id = like.tweet_id
      LEFT JOIN reply
        ON tweet.tweet_id = reply.tweet_id
      WHERE tweet.user_id = ${userId}
      GROUP BY tweet.tweet_id;
    `

  const tweets = await db.all(getUserTweetsQuery)

  response.send(tweets)
})

// ------------------ API 10 CREATE TWEET ------------------

app.post('/user/tweets/', authenticationToken, async (request, response) => {
  const {tweet} = request.body
  const {userId} = request

  const dateTime = new Date().toISOString().replace('T', ' ').substring(0, 19)

  const createTweetQuery = `
      INSERT INTO tweet (
        tweet,
        user_id,
        date_time
      )
      VALUES (
        '${tweet}',
        ${userId},
        '${dateTime}'
      );
    `

  await db.run(createTweetQuery)

  response.send('Created a Tweet')
})

// ------------------ API 11 DELETE TWEET ------------------

app.delete(
  '/tweets/:tweetId/',
  authenticationToken,
  async (request, response) => {
    const {tweetId} = request.params
    const {userId} = request

    const getTweetQuery = `
      SELECT *
      FROM tweet
      WHERE
        tweet_id = ${tweetId}
        AND user_id = ${userId};
    `

    const tweet = await db.get(getTweetQuery)

    if (tweet === undefined) {
      response.status(401)
      response.send('Invalid Request')
    } else {
      const deleteTweetQuery = `
        DELETE FROM tweet
        WHERE tweet_id = ${tweetId};
      `

      await db.run(deleteTweetQuery)

      response.send('Tweet Removed')
    }
  },
)

module.exports = app
