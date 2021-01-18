async function delay(ms) {
  // return await for better async stack trace support in case of errors.
  return await new Promise(resolve => setTimeout(resolve, ms));
}

async function do1(){
	console.log("predelay")
	await delay(2000);
	console.log("postdelay")
 	return 5;
}

async function do2(){
  x = do1();
  console.log("First", x);
  console.log("10??");
  return x;
}

console.log(do2())