var Buffy = module.exports = function() {
  this._store = new Array();
  this._length = 0;
};
Buffy.prototype.append = function(buffer) {
  this._length += buffer.length;
  this._store.push(buffer);
};
Buffy.prototype.indexOf = function(bytes, start) {
  if (start && (start < 0 || start >= this._length))
    return -1;//throw new Error('OOB');
  if (typeof bytes === 'number')
    bytes = [bytes];
  start = start || 0;
  var ret = -1, matching = false, foundStart = false, bn = 0, bc = 0, matchedAt,
      numbufs = this._store.length, buflen, bytesPos = 0,
      lastBytesPos = bytes.length-1, i;
  while (bn < numbufs) {
    i = 0;
    buflen = this._store[bn].length;
    if (!foundStart) {
      if (start >= buflen)
        start -= buflen;
      else {
        i = start;
        foundStart = true;
      }
    }
    if (foundStart) {
      for (; i<buflen; ++i) {
        if (this._store[bn][i] === bytes[bytesPos]) {
          if (bytesPos === 0) {
            matchedAt = bc + i;
          }
          if (bytesPos === lastBytesPos) {
            ret = matchedAt;
            break;
          }
          matching = true;
          ++bytesPos;
        } else if (matching) {
          matching = false;
          bytesPos = 0;
          --i; // retry current byte with reset bytesPos
        }
      }
      if (ret > -1)
        break;
    }
    bc += buflen;
    ++bn;
  }
  return ret;
};
Buffy.prototype.GCBefore = function(index) {
  if (index < 0 || index >= this._length)
    throw new Error('OOB');
  var toRemove = 0, amount = 0;
  for (var bn=0,i=0,len=this._store.length; bn<len; ++bn) {
    if (bn > 0) {
      amount += this._store[bn-1].length;
      this._length -= this._store[bn-1].length;
      ++toRemove;
    }
    i += this._store[bn].length;
    if (index < i)
      break;
  }
  if (toRemove > 0)
    this._store.splice(0, toRemove);
  return amount;
};
Buffy.prototype.copy = function(destBuffer, destStart, srcStart, srcEnd) {
  if (typeof srcEnd === 'undefined')
    srcEnd = this._length;
  destStart = destStart || 0;
  srcStart = srcStart || 0;
  if (srcStart < 0 || srcStart > this._length || srcEnd > this._length
      || srcStart > srcEnd || destStart + (srcEnd-srcStart) > destBuffer.length)
    throw new Error('OOB');
  if (srcStart !== srcEnd) {
    var foundStart = false, totalBytes = (srcEnd-srcStart),
        buflen, destPos = destStart;
    for (var bn=0,len=this._store.length; bn<len; ++bn) {
      buflen = this._store[bn].length;
      if (!foundStart) {
        if (srcStart >= buflen)
          srcStart -= buflen;
        else
          foundStart = true;
      }
      if (foundStart) {
        if ((totalBytes - destPos) <= (buflen - srcStart)) {
          this._store[bn].copy(destBuffer, destPos, srcStart, srcStart + (totalBytes - destPos));
          break;
        } else {
          this._store[bn].copy(destBuffer, destPos, srcStart, buflen);
          destPos += (buflen - srcStart);
          srcStart = 0;
        }
      }
    }
  }
};
Buffy.prototype.splice = function(index, howmany, el) {
  var idxLastDel = index + howmany, idxLastAdd = index,
      numNew = 0, newEls, idxRet = 0;
  if (index < 0 || index >= this._length || howmany < 0 || idxLastDel >= this._length)
    throw new Error('OOB');
  if (el) {
    newEls = Array.prototype.slice.call(arguments).slice(2);
    numNew = newEls.length;
    idxLastAdd = index + numNew;
  }
  var idxLastMin = Math.min(idxLastAdd, idxLastDel),
      idxLastMax = Math.max(idxLastAdd, idxLastDel);
  var ret = new Array(howmany);
  if (numNew === howmany) {
    for (var bn=0,i=0,blen,start=-1,len=this._store.length; bn<len; ++bn) {
      blen = this._store[bn].length;
      if (start < 0) {
        i += blen;
        if (index < i)
          start = blen-(i-index);
      } else {
        for (var j=start; j<blen; ++j,++index) {
          if (index === idxLastAdd)
            return ret;
          ret[idxRet] = this._store[bn][j];
          this._store[bn][j] = newEls[idxRet++];
        }
        start = 0;
      }
    }
  } else {
    
  }
  return ret;
};
Buffy.prototype.__defineGetter__('length', function() {
  return this._length;
});
Buffy.prototype.get = function(index) {
  var ret = false;
  if (index >= 0 && index < this._length) {
    for (var bn=0,i=0,blen,len=this._store.length; bn<len; ++bn) {
      blen = this._store[bn].length
      i += blen;
      if (index < i) {
        ret = this._store[bn][blen-(i-index)];
        break;
      }
    }
  }
  return ret;
};
Buffy.prototype.set = function(index, value) {
  var ret = false;
  if (index >= 0 && index < this._length && typeof value === 'number'
      && value >= 0 && value <= 255) {
    for (var bn=0,i=0,blen,len=this._store.length; bn<len; ++bn) {
      blen = this._store[bn].length
      i += blen;
      if (index < i) {
        this._store[bn][blen-(i-index)] = value;
        ret = true;
        break;
      }
    }
  }
  return ret;
};
Buffy.prototype.toString = function(encoding, start, end) {
  var ret = new Array();
  if (typeof end === 'undefined')
    end = this._length;
  start = start || 0;
  if (start < 0 || start > this._length || end > this._length || start > end)
    throw new Error('OOB');
  if (start !== end) {
    if (start === 0 && end === this._length) {
      // simple case
      for (var i=0,len=this._store.length; i<len; ++i)
        ret.push(this._store[i].toString(encoding));
    } else {
      var foundStart = false, totalBytes = (end-start),
          buflen, destPos = 0;
      for (var bn=0,len=this._store.length; bn<len; ++bn) {
        buflen = this._store[bn].length;
        if (!foundStart) {
          if (start >= buflen)
            start -= buflen;
          else
            foundStart = true;
        }
        if (foundStart) {
          if ((totalBytes - destPos) <= (buflen - start)) {
            ret.push(this._store[bn].toString(encoding, start, start + (totalBytes - destPos)));
            break;
          } else {
            ret.push(this._store[bn].toString(encoding, start, buflen));
            destPos += (buflen - start);
            start = 0;
          }
        }
      }
    }
  }
  return ret.join('');
};
Buffy.prototype.inspect = function() {
  var len = this._store.length, ret = '<Buffy' + (len === 0 ? ' ' : '');
  for (var i=0,tmp,len=this._store.length; i<len; ++i) {
    tmp = this._store[i].inspect();
    ret += ' ' + tmp.substring(7, tmp.length-1).trim();
  }
  ret += '>';
  return ret;
};