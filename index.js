const express = require('express')
const app = express()
require('dotenv').config()
const cors = require('cors')
const cookieParser = require('cookie-parser')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const jwt = require('jsonwebtoken')
const morgan = require('morgan')
const port = process.env.PORT || 8000
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY)


// middleware
const corsOptions = {
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  credentials: true,
  optionSuccessStatus: 200,
}
app.use(cors(corsOptions))
app.use(express.json())
app.use(cookieParser())
app.use(morgan('dev'))
const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token
  console.log("Token",token)
  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log("jwt verify err",err)
      return res.status(401).send({ message: 'unauthorized access' })
    }
    req.user = decoded
    next()
  })
}



const client = new MongoClient(process.env.DB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})
async function run() {
  try {
    const usersCollection = client.db('turnejaDb').collection('users')
    const roomsCollection = client.db('turnejaDb').collection('rooms')
    const bookingsCollection = client.db('turnejaDb').collection('bookings')
    
    //verify admin , host
    const verifyAmin = async(req,res,next)=>{
      const user = req.user;
      console.log("user from verify admin",user)
      const query = {email: user?.email}
      const result = await usersCollection.findOne(query)
      if(!result || result?.role !== 'admin') return res.status(401).send({message:"Unauthorized Access"})
        next();
    }
    const verifyHost = async(req,res,next)=>{
      const user = req.user;
      const query = {email: user?.email}
      const result = await usersCollection.findOne(query)
      if(!result || result?.role !== 'host') return res.status(401).send({message:"Unauthorized Access"})
        next();
    }



    // auth related api
    // Backend code inside run() function
app.post('/jwt', async (req, res) => {
  const user = req.body;
  console.log('I need a new jwt', user);
  
  // Check if user exists
  const existingUser = await usersCollection.findOne({ email: user.email });

  if (existingUser) {
    // Generate token and return user info if user exists
    const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
      expiresIn: '365d',
    });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
    }).send({ success: true, user: existingUser });
  } else {
    // If user doesn't exist, just return success false
    res.send({ success: false, message: "User does not exist." });
  }
});

    // Logout
    app.get('/logout', async (req, res) => {
      try {
        res
          .clearCookie('token', {
            maxAge: 0,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
          })
          .send({ success: true })
        console.log('Logout successful')
      } catch (err) {
        res.status(500).send(err)
      }
    })

    // Save or modify user email, status in DB

app.put('/users/:email', async (req, res) => {
  const email = req.params.email;
  console.log("requested email",email)
  const user = req.body;
  console.log("requested user",user.status)
  const query = { email: email };
  const options = { upsert: true }; 

  const isExist = await usersCollection.findOne(query);

  console.log('User found?----->', isExist )

  if (isExist) {
    if(user?.status === "requested"){
      const result = await usersCollection.updateOne(
        query,
        {
          $set:user,
        },
        options,
      )
      return res.send(result)
    }
    else{
      return res.send(isExist)
    }
  }

    
    const result =await usersCollection.updateOne(
      query,
      {
        $set:{...user, timestamp: Date.now() },
      },
      options
    )
    res.send("updated User",result)
  
});

    //user role

    app.get('/user/:email', async(req,res)=>{
      const email = req.params.email;
      const result = await usersCollection.findOne({email})
      res.send(result)
      // console.log("user role",result)
    })
//all rooms
    app.get('/rooms', async(req, res)=>{
      const result =await roomsCollection.find().toArray()
      res.send(result);
    })
//room for host
    app.get('/room/:email',verifyToken,verifyHost, async (req,res)=>{
      const email= req.params.email;
      const result= await roomsCollection.find({'host.email':email}).toArray()
      res.send(result)
      console.log("room for host",result)
    })

    // single room data
    app.get('/rooms/:id', async(req,res)=>{
      const id = req.params.id
      const result = await roomsCollection.findOne({_id : new ObjectId(id)})
      res.send(result)
    })



    // save room in database
    app.post('/rooms',verifyToken,async(req, res)=>{
      const room = req.body;
      const result =await roomsCollection.insertOne(room);
      res.send(result)
    })

    // stripe
    app.post('/create-payment-intent', verifyToken, async(req,res)=>{
      const {price} = req.body
      const amount = parseInt(price*100)
      if(!price || amount <1) return
      const {client_secret} = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card'],
      })
      res.send({clientSecret: client_secret})
    })

    //booking info save in  booking collection
    app.post('/bookings',verifyToken, async(req,res)=>{
      const booking = req.body
      const result = await bookingsCollection.insertOne(booking)

      //email 
      res.send(result)
    })
    //update room booking
    app.patch('/rooms/status/:id', async(req,res)=>{
      const id = req.params.id
      const status = req.body.status
      const query = {_id: new ObjectId(id)}
      const updateDoc ={
        $set: {
          booked: status,
        }
      }
      const result = await roomsCollection.updateOne(query, updateDoc)
      res.send(result)
    })


    //booking for guest
    app.get('/bookings',verifyToken, async (req,res)=>{
      const email = req.query.email
      if (!email) return res.send([])
        const query = {'guest.email': email}
        const result =  await bookingsCollection.find(query).toArray()
        res.send(result)
    })


    
    app.get('/bookings/host',verifyToken, verifyHost, async (req,res)=>{
      const email = req.query.email
      if (!email) return res.send([])
        const query = {'host': email}
        const result =  await bookingsCollection.find(query).toArray()
        res.send(result)
    })

    //all users get
    app.get('/users',verifyToken,verifyAmin,async(req,res)=>{
      const result = await usersCollection.find().toArray()
      res.send(result)
    })

    //role update
    app.put('/users/update/:email',verifyToken, async(req,res)=>{
      const email = req.params.email;
      const user = req.body;
      console.log(user)
      const query = {email: email};
      const options= {upsert: true};
      const updateDoc = {
        $set: {
          ...user, timestamp: Date.now()
        },
      }
      const result = await usersCollection.updateOne(query, updateDoc, options);
      res.send(result);
    })



    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from turneja..')
})

app.listen(port, () => {
  console.log(`turneja is running on port ${port}`)
})
