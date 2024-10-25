## Introduction
MultiParter is an Express middleware library for parsing multipart/form-data requests. It is based on [Busboy](https://github.com/mscdex/busboy) and took inspiration from [Multer](https://github.com/expressjs/multer) and [Transmit](https://github.com/quicksend/transmit/).

## Warning
Currently this library is in a pre-release state. There is one known DoS vulnerability that is hard to work around. It is the same as [this Multer issue](https://github.com/expressjs/multer/issues/1176). When this issue is fixed, the library should be in a releaseable state. Feel free to contribute!
