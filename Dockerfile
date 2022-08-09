FROM node:18-alpine
WORKDIR /usr/app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src src
COPY test test
RUN node -e 'console.log(new Date().getTime())' > /.builddate
CMD ["npm", "run", "watch"]
